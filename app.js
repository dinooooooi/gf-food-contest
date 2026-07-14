/* ═══════════ 여자친구 음식 자랑 대회 (Supabase) ═══════════ */

const ADMIN_EMAIL = 'savntew@gmail.com';
const BEST_LIMIT = 3;
const BUCKET = 'photos';

const $ = (sel) => document.querySelector(sel);
const CFG = window.GFFC_CONFIG || {};

let sb = null;          // supabase client
let me = null;          // { id, email }
let myRecords = [];
let feedRecords = [];
let coupleRecords = [];
let partner = null;     // { id } | null
let myHearts = new Set(); // 내가 하트 누른 record id
let nicks = new Map();  // user id -> nickname (공개 표시명)
let myNick = '';
let currentView = 'mine';

function nick(id) {
  return nicks.get(id) || '익명 셰프';
}

/* ───────── 유틸 ───────── */

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDate(iso) {
  return iso ? String(iso).slice(0, 10).replaceAll('-', '.') : '';
}

function starHtml(rating, cls) {
  let s = '';
  for (let i = 1; i <= 5; i++) s += `<span class="${i <= rating ? '' : 'off'}">★</span>`;
  return `<span class="${cls}">${s}</span>`;
}

function photoUrl(path) {
  return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 1200;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('압축 실패'))), 'image/jpeg', 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 읽을 수 없어요')); };
    img.src = url;
  });
}

function authErrorKo(msg) {
  const m = String(msg || '');
  if (m.includes('Invalid login credentials')) return '이메일 또는 비밀번호가 틀렸어요 (>_<)';
  if (m.includes('already registered')) return '이미 가입된 이메일이에요! 로그인해 주세요';
  if (m.includes('Email not confirmed')) return '이메일 인증이 아직이에요! 인증번호를 다시 보냈어요';
  if (m.includes('expired') || m.includes('invalid') || m.includes('Invalid')) return '인증번호가 틀렸거나 만료됐어요. 다시 확인해 주세요!';
  if (m.includes('rate limit') || m.includes('rate_limit')) return '요청이 너무 잦아요! 잠시 후 다시 시도해 주세요';
  if (m.includes('at least 6')) return '비밀번호는 6자 이상으로 해주세요!';
  return '앗, 오류가 났어요: ' + m;
}

/* ───────── 인증 ───────── */

let authMode = 'login';
let pendingEmail = '';

function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll('.auth-tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === mode));
  $('#authSubmit').textContent = mode === 'login' ? '로그인 ♥' : '회원가입 ♥';
  $('#authError').textContent = '';
}

let pendingPw = '';
let waitTimer = null;

function showWaitStep(email, pw) {
  pendingEmail = email;
  pendingPw = pw;
  $('#otpEmail').textContent = email;
  $('#otpError').textContent = '';
  $('#otpCode').value = '';
  $('#authStep1').classList.add('hidden');
  $('#authStep2').classList.remove('hidden');
  $('#otpCode').focus();
  startWaitPolling();
}

async function handleOtp(e) {
  e.preventDefault();
  const token = $('#otpCode').value.trim();
  const err = $('#otpError');
  err.textContent = '';
  const { data, error } = await sb.auth.verifyOtp({ email: pendingEmail, token, type: 'signup' });
  if (error) {
    // 재전송 코드 등은 타입이 다를 수 있어 email 타입으로 한 번 더 시도
    const retry = await sb.auth.verifyOtp({ email: pendingEmail, token, type: 'email' });
    if (retry.error) { err.textContent = authErrorKo(error.message); return; }
    backToStep1();
    enterMain(retry.data.session.user);
    return;
  }
  backToStep1();
  enterMain(data.session.user);
}

function backToStep1() {
  stopWaitPolling();
  $('#authStep2').classList.add('hidden');
  $('#authStep1').classList.remove('hidden');
}

/* 메일의 인증 링크를 누르면 자동으로 로그인되도록 주기적으로 시도 */
function startWaitPolling() {
  stopWaitPolling();
  const startedAt = Date.now();
  waitTimer = setInterval(async () => {
    if (Date.now() - startedAt > 10 * 60 * 1000) { stopWaitPolling(); return; }
    const { data, error } = await sb.auth.signInWithPassword({ email: pendingEmail, password: pendingPw });
    if (!error && data.session) {
      stopWaitPolling();
      backToStep1();
      enterMain(data.session.user);
    }
  }, 7000);
}

function stopWaitPolling() {
  if (waitTimer) { clearInterval(waitTimer); waitTimer = null; }
}

async function handleAuth(e) {
  e.preventDefault();
  const email = $('#authEmail').value.trim().toLowerCase();
  const pw = $('#authPw').value;
  const err = $('#authError');
  err.textContent = '';
  $('#authSubmit').disabled = true;

  try {
    if (authMode === 'signup') {
      const { data, error } = await sb.auth.signUp({ email, password: pw });
      if (error) { err.textContent = authErrorKo(error.message); return; }
      // 이미 가입+인증까지 끝난 이메일이면 identities가 빈 배열로 옴
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        err.textContent = '이미 가입된 이메일이에요! 로그인해 주세요';
        return;
      }
      if (data.session) { enterMain(data.session.user); return; } // 이메일 인증 꺼진 경우
      showWaitStep(email, pw);
    } else {
      const { data, error } = await sb.auth.signInWithPassword({ email, password: pw });
      if (error) {
        if (String(error.message).includes('Email not confirmed')) {
          await sb.auth.resend({ type: 'signup', email });
          showWaitStep(email, pw);
          return;
        }
        err.textContent = authErrorKo(error.message);
        return;
      }
      enterMain(data.session.user);
    }
  } finally {
    $('#authSubmit').disabled = false;
  }
}

async function handleResend() {
  $('#otpError').textContent = '';
  const { error } = await sb.auth.resend({ type: 'signup', email: pendingEmail });
  $('#otpError').textContent = error ? authErrorKo(error.message) : '인증번호를 다시 보냈어요! 💌';
}

async function logout() {
  await sb.auth.signOut();
  me = null;
  $('#mainScreen').classList.add('hidden');
  $('#authScreen').classList.remove('hidden');
}

/* ───────── 데이터 ───────── */

// 이메일 컬럼(owner_email)은 일부러 조회하지 않음 → 클라이언트에 노출 안 됨
const RECORD_COLS = 'id,owner,title,date,descr,rating,photos,is_public,best_at,created_at, reactions(count), comments(count)';

function socialCounts(r) {
  r._hearts = r.reactions?.[0]?.count || 0;
  r._comments = r.comments?.[0]?.count || 0;
  return r;
}

async function loadNicks() {
  const { data } = await sb.from('profiles').select('id,nickname');
  nicks = new Map((data || []).map((p) => [p.id, p.nickname]));
  myNick = nicks.get(me.id) || '';
}

async function loadMine() {
  const { data, error } = await sb.from('records').select(RECORD_COLS)
    .eq('owner', me.id)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) { console.error(error); alert('기록을 불러오지 못했어요 (>_<)'); return; }
  myRecords = (data || []).map(socialCounts);
}

async function loadFeed() {
  const { data, error } = await sb.from('records').select(RECORD_COLS)
    .eq('is_public', true)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) { console.error(error); return; }
  feedRecords = (data || []).map(socialCounts);
}

async function loadCouple() {
  const { data, error } = await sb.from('couples').select('id,a,b')
    .or(`a.eq.${me.id},b.eq.${me.id}`)
    .not('b', 'is', null)
    .maybeSingle();
  if (error || !data) { partner = null; coupleRecords = []; return; }
  partner = { id: data.a === me.id ? data.b : data.a };
  const res = await sb.from('records').select(RECORD_COLS)
    .in('owner', [me.id, partner.id])
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });
  coupleRecords = (res.data || []).map(socialCounts);
}

async function loadMyHearts() {
  const { data } = await sb.from('reactions').select('record_id').eq('user_id', me.id);
  myHearts = new Set((data || []).map((x) => x.record_id));
}

async function refresh() {
  await loadNicks();
  await Promise.all([loadMine(), loadFeed(), loadCouple(), loadMyHearts()]);
  render();
}

/* ───────── 메인 렌더링 ───────── */

async function enterMain(user) {
  me = { id: user.id, email: user.email };
  $('#authScreen').classList.add('hidden');
  $('#mainScreen').classList.remove('hidden');

  // 닉네임이 없으면 먼저 설정하도록 안내
  const { data } = await sb.from('profiles').select('nickname').eq('id', me.id).maybeSingle();
  if (!data) { openNickModal(true); return; } // 저장 후 refresh가 이어짐
  myNick = data.nickname;
  refresh();
}

function renderUserChip() {
  const isAdmin = me.email === ADMIN_EMAIL;
  $('#userChip').innerHTML = (isAdmin ? '<span class="admin-mark">👑 관리자</span> · ' : '') + '♥ ' + escapeHtml(myNick || '셰프') + ' <span class="nick-edit">✏️</span>';
  $('#userChip').onclick = () => openNickModal(false);
}

/* ───────── 닉네임 설정 ───────── */

function openNickModal(first) {
  $('#nickModalTitle').textContent = first ? '닉네임을 정해주세요 ♥' : '닉네임 바꾸기 ♥';
  $('#nickInput').value = myNick || '';
  $('#nickError').textContent = '';
  $('#nickCancel').classList.toggle('hidden', first); // 최초 설정 때는 취소 불가
  $('#nickModal').classList.remove('hidden');
  $('#nickInput').focus();
}

async function handleNickSave(e) {
  e.preventDefault();
  const nickname = $('#nickInput').value.trim();
  if (!nickname) { $('#nickError').textContent = '닉네임을 입력해 주세요!'; return; }
  const { error } = await sb.from('profiles').upsert({ id: me.id, nickname });
  if (error) { $('#nickError').textContent = '저장에 실패했어요 (>_<)'; return; }
  myNick = nickname;
  $('#nickModal').classList.add('hidden');
  refresh();
}

function setView(view) {
  currentView = view;
  document.querySelectorAll('.view-tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  $('#mineView').classList.toggle('hidden', view !== 'mine');
  $('#coupleView').classList.toggle('hidden', view !== 'couple');
  $('#feedView').classList.toggle('hidden', view !== 'feed');
}

function render() {
  renderUserChip();
  renderBest();
  renderList();
  renderCouple();
  renderFeed();
}

function myBest() {
  return myRecords.filter((r) => r.best_at).sort((a, b) => new Date(a.best_at) - new Date(b.best_at)).slice(0, BEST_LIMIT);
}

function renderBest() {
  const grid = $('#bestGrid');
  const best = myBest();
  const medals = ['🥇', '🥈', '🥉'];
  grid.innerHTML = '';

  for (let i = 0; i < BEST_LIMIT; i++) {
    const r = best[i];
    const card = document.createElement('div');
    if (r) {
      card.className = 'best-card';
      const photo = r.photos && r.photos[0]
        ? `<img class="best-photo" src="${photoUrl(r.photos[0])}" alt="" loading="lazy">`
        : '<div class="best-photo-empty">🍽️</div>';
      card.innerHTML = `<span class="best-rank">${medals[i]}</span>${photo}<div class="best-name">${escapeHtml(r.title)}</div>`;
      card.addEventListener('click', () => openDetail(r));
    } else {
      card.className = 'best-card best-empty';
      card.innerHTML = `<span class="best-rank">${medals[i]}</span><div class="best-photo-empty">✨</div><div class="best-name">비어있어요</div>`;
    }
    grid.appendChild(card);
  }
}

function recordCardEl(r, showOwner) {
  const card = document.createElement('div');
  card.className = 'record-card';
  const thumb = r.photos && r.photos[0]
    ? `<img class="record-thumb" src="${photoUrl(r.photos[0])}" alt="" loading="lazy">`
    : '<div class="record-thumb-empty">🍽️</div>';
  const visBadge = showOwner ? '' : (r.is_public
    ? '<span class="record-vis-badge vis-public">💖 전체공개</span>'
    : '<span class="record-vis-badge">🔒 나만보기</span>');
  card.innerHTML = `
    ${thumb}
    <div class="record-info">
      <div class="record-head">
        <span class="record-name">${escapeHtml(r.title)}</span>
        ${r.best_at ? '<span class="record-best-badge">👑 BEST</span>' : ''}
        ${visBadge}
      </div>
      <div class="record-date">📅 ${fmtDate(r.date)}${showOwner ? ` · <span class="record-owner">${escapeHtml(nick(r.owner))}</span>` : ''}</div>
      <div class="record-desc">${escapeHtml(r.descr)}</div>
      <div class="record-foot">
        <span class="record-stars">${starHtml(r.rating, '')}</span>
        <span class="record-social">
          <button type="button" class="heart-btn ${myHearts.has(r.id) ? 'on' : ''}">♥ <b>${r._hearts}</b></button>
          <span class="cmt-count">💬 ${r._comments}</span>
        </span>
      </div>
    </div>`;
  card.querySelector('.heart-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleHeart(r, card.querySelector('.heart-btn'));
  });
  card.addEventListener('click', () => openDetail(r));
  return card;
}

/* 하트 토글 (화면 즉시 반영) */
async function toggleHeart(r, btn) {
  const had = myHearts.has(r.id);
  // 즉시 반영
  if (had) { myHearts.delete(r.id); r._hearts--; } else { myHearts.add(r.id); r._hearts++; }
  if (btn) { btn.classList.toggle('on', !had); btn.querySelector('b').textContent = r._hearts; }
  const { error } = had
    ? await sb.from('reactions').delete().eq('record_id', r.id).eq('user_id', me.id)
    : await sb.from('reactions').insert({ record_id: r.id, user_id: me.id });
  if (error) { // 실패 시 되돌리기
    if (had) { myHearts.add(r.id); r._hearts++; } else { myHearts.delete(r.id); r._hearts--; }
    if (btn) { btn.classList.toggle('on', had); btn.querySelector('b').textContent = r._hearts; }
  }
}

function renderList() {
  const list = $('#recordList');
  $('#recordCount').textContent = myRecords.length + '개';
  list.innerHTML = '';
  if (!myRecords.length) {
    list.innerHTML = '<div class="record-empty">아직 기록이 없어요 (´•̥ ω •̥`)<br>오른쪽 아래 <b>＋</b> 버튼으로 첫 요리를 자랑해 주세요!</div>';
    return;
  }
  myRecords.forEach((r) => list.appendChild(recordCardEl(r, false)));
}

function renderCouple() {
  const panel = $('#couplePanel');
  const list = $('#coupleList');
  list.innerHTML = '';

  if (!partner) {
    panel.innerHTML = `
      <div class="couple-box">
        <p class="couple-msg">아직 연동된 상대가 없어요!<br>커플 코드로 서로를 연결해 보세요 💕</p>
        <button type="button" id="coupleMakeBtn" class="btn-big">💌 내 커플 코드 만들기</button>
        <div id="coupleCodeShow" class="couple-code hidden"></div>
        <div class="couple-divider">─ 또는 ─</div>
        <form id="coupleJoinForm" class="couple-join">
          <input type="text" id="coupleCodeInput" class="pixel-input" placeholder="상대방 코드 입력 (6자리)" maxlength="6" required>
          <button type="submit" class="btn-best">연동하기 ♥</button>
        </form>
        <p id="coupleError" class="auth-error"></p>
      </div>`;
    $('#coupleMakeBtn').addEventListener('click', makeCoupleCode);
    $('#coupleJoinForm').addEventListener('submit', joinCouple);
    return;
  }

  panel.innerHTML = `
    <div class="couple-box couple-linked">
      <p class="couple-msg">💑 <b>${escapeHtml(nick(me.id))}</b> ♥ <b>${escapeHtml(nick(partner.id))}</b><br>둘의 기록을 모두 볼 수 있어요! (🔒 나만보기 포함)</p>
      <button type="button" id="coupleUnlinkBtn" class="btn-tiny">연동 해제</button>
    </div>`;
  $('#coupleUnlinkBtn').addEventListener('click', async () => {
    if (!confirm(`${nick(partner.id)} 님과의 연동을 해제할까요?`)) return;
    const { error } = await sb.rpc('unlink_couple');
    if (error) { alert('해제에 실패했어요 (>_<)'); return; }
    refresh();
  });

  if (!coupleRecords.length) {
    list.innerHTML = '<div class="record-empty">아직 둘 다 기록이 없어요 (´•̥ ω •̥`)</div>';
    return;
  }
  coupleRecords.forEach((r) => list.appendChild(recordCardEl(r, true)));
}

async function makeCoupleCode() {
  $('#coupleError').textContent = '';
  const { data, error } = await sb.rpc('create_couple_code');
  if (error) { $('#coupleError').textContent = error.message; return; }
  const box = $('#coupleCodeShow');
  box.classList.remove('hidden');
  box.innerHTML = `내 코드: <b>${escapeHtml(data)}</b><br><span class="couple-code-hint">상대방이 이 코드를 입력하면 연동 완료! (연동되면 자동 반영돼요 — 새로고침해 보세요)</span>`;
}

async function joinCouple(e) {
  e.preventDefault();
  $('#coupleError').textContent = '';
  const code = $('#coupleCodeInput').value.trim();
  const { data, error } = await sb.rpc('join_couple', { p_code: code });
  if (error) { $('#coupleError').textContent = error.message.replace(/^.*?: /, ''); return; }
  alert(`💑 ${data} 님과 연동됐어요!`);
  refresh();
}

function renderFeed() {
  const list = $('#feedList');
  list.innerHTML = '';
  if (!feedRecords.length) {
    list.innerHTML = '<div class="record-empty">아직 전체공개 자랑글이 없어요 (´•̥ ω •̥`)<br>기록을 <b>💖 전체공개</b>로 올리면 여기에 떠요!</div>';
    return;
  }
  feedRecords.forEach((r) => list.appendChild(recordCardEl(r, true)));
}

/* ───────── 기록 추가/수정 모달 ───────── */

let editingId = null;
let pendingPhotos = [];   // { path } 기존 | { blob } 신규
let removedPaths = [];
let pendingRating = 0;
let pendingVis = 'private';

function openRecordModal(record) {
  editingId = record ? record.id : null;
  pendingPhotos = record ? (record.photos || []).map((p) => ({ path: p })) : [];
  removedPaths = [];
  pendingRating = record ? record.rating : 0;
  pendingVis = record ? (record.is_public ? 'public' : 'private') : 'private';

  $('#recordModalTitle').textContent = record ? '요리 기록 수정 ♥' : '새 요리 기록 ♥';
  $('#recTitle').value = record ? record.title : '';
  $('#recDate').value = record ? String(record.date).slice(0, 10) : new Date().toISOString().slice(0, 10);
  $('#recDesc').value = record ? record.descr : '';
  renderPhotoPreview();
  renderStarPicker();
  renderVisPicker();
  $('#recordModal').classList.remove('hidden');
}

function renderPhotoPreview() {
  const box = $('#photoPreview');
  box.innerHTML = '';
  pendingPhotos.forEach((p, i) => {
    const src = p.path ? photoUrl(p.path) : URL.createObjectURL(p.blob);
    const cell = document.createElement('div');
    cell.className = 'photo-cell';
    cell.innerHTML = `<img src="${src}" alt=""><button type="button" class="photo-del">✕</button>`;
    cell.querySelector('.photo-del').addEventListener('click', () => {
      if (p.path) removedPaths.push(p.path);
      pendingPhotos.splice(i, 1);
      renderPhotoPreview();
    });
    box.appendChild(cell);
  });
}

function renderStarPicker() {
  document.querySelectorAll('#starPicker button').forEach((b) => {
    b.classList.toggle('on', Number(b.dataset.v) <= pendingRating);
  });
}

function renderVisPicker() {
  document.querySelectorAll('#visPicker .vis-btn').forEach((b) => {
    b.classList.toggle('on', b.dataset.vis === pendingVis);
  });
}

async function handlePhotoInput(e) {
  const files = [...e.target.files];
  e.target.value = '';
  for (const f of files) {
    try {
      pendingPhotos.push({ blob: await compressImage(f) });
    } catch {
      alert('사진 하나를 읽지 못했어요 (>_<)');
    }
  }
  renderPhotoPreview();
}

async function handleRecordSave(e) {
  e.preventDefault();
  if (!pendingRating) { alert('별점을 매겨주세요! ⭐'); return; }

  const btn = $('#recordSaveBtn');
  btn.disabled = true;
  btn.textContent = '저장 중... 🍳';

  try {
    // 새 사진 업로드
    const paths = [];
    for (const p of pendingPhotos) {
      if (p.path) { paths.push(p.path); continue; }
      const path = `${me.id}/${crypto.randomUUID()}.jpg`;
      const { error } = await sb.storage.from(BUCKET).upload(path, p.blob, { contentType: 'image/jpeg' });
      if (error) throw error;
      paths.push(path);
    }

    const row = {
      owner: me.id,
      owner_email: me.email,
      title: $('#recTitle').value.trim(),
      date: $('#recDate').value,
      descr: $('#recDesc').value.trim(),
      rating: pendingRating,
      photos: paths,
      is_public: pendingVis === 'public',
    };

    if (editingId) {
      const { error } = await sb.from('records').update(row).eq('id', editingId);
      if (error) throw error;
    } else {
      const { error } = await sb.from('records').insert(row);
      if (error) throw error;
    }

    if (removedPaths.length) await sb.storage.from(BUCKET).remove(removedPaths);

    closeModal('recordModal');
    await refresh();
  } catch (err) {
    console.error(err);
    alert('저장에 실패했어요 (>_<)\n' + (err.message || err));
  } finally {
    btn.disabled = false;
    btn.textContent = '저장하기 ♥';
  }
}

/* ───────── 상세 보기 ───────── */

function openDetail(r) {
  const mine = r.owner === me.id;
  $('#detailTitle').textContent = r.title;

  const photos = (r.photos || []).map((p) => `<img src="${photoUrl(p)}" alt="" loading="lazy">`).join('');
  const actions = [];
  if (mine) {
    actions.push(`<button type="button" class="btn-best" id="detailBestBtn">${r.best_at ? '👑 BEST 해제' : '👑 BEST 지정'}</button>`);
    actions.push('<button type="button" class="btn-gray" id="detailEditBtn">✏️ 수정</button>');
    actions.push('<button type="button" class="btn-danger" id="detailDelBtn">🗑 삭제</button>');
  }

  $('#detailBody').innerHTML = `
    ${photos ? `<div class="detail-photos">${photos}</div>` : ''}
    <div class="detail-meta">
      <span class="detail-date">📅 ${fmtDate(r.date)}</span>
      ${starHtml(r.rating, 'detail-stars')}
    </div>
    ${r.descr ? `<div class="detail-desc">${escapeHtml(r.descr)}</div>` : ''}
    <div class="detail-owner">작성: ${escapeHtml(nick(r.owner))}${r.best_at ? ' · 👑 BEST' : ''} · ${r.is_public ? '💖 전체공개' : '🔒 나만보기'}</div>
    <div class="detail-social">
      <button type="button" class="heart-btn heart-btn-big ${myHearts.has(r.id) ? 'on' : ''}" id="detailHeartBtn">♥ <b>${r._hearts || 0}</b></button>
    </div>
    <div class="comments-box">
      <div class="comments-title">💬 댓글</div>
      <div id="commentList" class="comment-list"><span class="comment-loading">불러오는 중...</span></div>
      <form id="commentForm" class="comment-form">
        <input type="text" id="commentInput" class="pixel-input" placeholder="댓글을 남겨보세요 ♥" maxlength="500" required>
        <button type="submit" class="btn-best">등록</button>
      </form>
    </div>
    ${actions.length ? `<div class="detail-actions">${actions.join('')}</div>` : ''}`;

  $('#detailHeartBtn').addEventListener('click', () => toggleHeart(r, $('#detailHeartBtn')));
  $('#commentForm').addEventListener('submit', (e) => submitComment(e, r));
  loadComments(r);

  const bestBtn = $('#detailBestBtn');
  if (bestBtn) bestBtn.addEventListener('click', () => toggleBest(r));
  const editBtn = $('#detailEditBtn');
  if (editBtn) editBtn.addEventListener('click', () => { closeModal('detailModal'); openRecordModal(r); });
  const delBtn = $('#detailDelBtn');
  if (delBtn) delBtn.addEventListener('click', async () => {
    if (!confirm(`"${r.title}" 기록을 삭제할까요?`)) return;
    const { error } = await sb.from('records').delete().eq('id', r.id);
    if (error) { alert('삭제에 실패했어요 (>_<)'); return; }
    if (r.photos && r.photos.length) await sb.storage.from(BUCKET).remove(r.photos);
    closeModal('detailModal');
    refresh();
  });

  $('#detailModal').classList.remove('hidden');
}

/* ───────── 댓글 ───────── */

async function loadComments(r) {
  const box = $('#commentList');
  const { data, error } = await sb.from('comments').select('id,record_id,author,content,created_at')
    .eq('record_id', r.id)
    .order('created_at', { ascending: true });
  if (!box || error) { if (box) box.innerHTML = '<span class="comment-loading">댓글을 불러오지 못했어요</span>'; return; }
  box.innerHTML = '';
  if (!data.length) {
    box.innerHTML = '<span class="comment-loading">첫 댓글을 남겨보세요! ♥</span>';
    return;
  }
  data.forEach((c) => {
    const canDel = c.author === me.id || r.owner === me.id; // 댓글 작성자 또는 글쓴이
    const el = document.createElement('div');
    el.className = 'comment-item';
    el.innerHTML = `
      <div class="comment-head">
        <span class="comment-author">${escapeHtml(nick(c.author))}</span>
        <span class="comment-date">${fmtDate(c.created_at)}</span>
        ${canDel ? '<button type="button" class="comment-del">✕</button>' : ''}
      </div>
      <div class="comment-content">${escapeHtml(c.content)}</div>`;
    const del = el.querySelector('.comment-del');
    if (del) del.addEventListener('click', async () => {
      if (!confirm('이 댓글을 삭제할까요?')) return;
      const { error: e2 } = await sb.from('comments').delete().eq('id', c.id);
      if (e2) { alert('삭제에 실패했어요 (>_<)'); return; }
      r._comments = Math.max(0, (r._comments || 1) - 1);
      loadComments(r);
    });
    box.appendChild(el);
  });
}

async function submitComment(e, r) {
  e.preventDefault();
  const input = $('#commentInput');
  const content = input.value.trim();
  if (!content) return;
  const { error } = await sb.from('comments').insert({
    record_id: r.id, author: me.id, author_email: me.email, content,
  });
  if (error) { alert('댓글 등록에 실패했어요 (>_<)'); return; }
  input.value = '';
  r._comments = (r._comments || 0) + 1;
  loadComments(r);
}

async function toggleBest(r) {
  if (!r.best_at && myBest().length >= BEST_LIMIT) {
    alert(`BEST는 ${BEST_LIMIT}개까지만! 먼저 하나를 해제해 주세요 👑`);
    return;
  }
  const { error } = await sb.from('records').update({ best_at: r.best_at ? null : new Date().toISOString() }).eq('id', r.id);
  if (error) { alert('변경에 실패했어요 (>_<)'); return; }
  closeModal('detailModal');
  refresh();
}

/* ───────── 모달 공통 ───────── */

function closeModal(id) {
  $('#' + id).classList.add('hidden');
  if (id === 'detailModal' && me) render(); // 모달에서 바뀐 하트/댓글 수를 목록에 반영
}

/* ───────── 초기화 ───────── */

async function init() {
  if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) {
    $('#authStep1').classList.add('hidden');
    $('#authSetup').classList.remove('hidden');
    return;
  }
  sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

  // 메일 인증 링크로 이 탭이 열린 경우 자동 로그인 처리
  sb.auth.onAuthStateChange((event, sess) => {
    if (event === 'SIGNED_IN' && sess && !me) {
      stopWaitPolling();
      backToStep1();
      enterMain(sess.user);
    }
  });

  document.querySelectorAll('.auth-tab').forEach((t) => t.addEventListener('click', () => setAuthMode(t.dataset.mode)));
  $('#authForm').addEventListener('submit', handleAuth);
  $('#otpForm').addEventListener('submit', handleOtp);
  $('#otpResend').addEventListener('click', handleResend);
  $('#nickForm').addEventListener('submit', handleNickSave);
  $('#nickCancel').addEventListener('click', () => $('#nickModal').classList.add('hidden'));
  $('#otpBack').addEventListener('click', backToStep1);
  $('#logoutBtn').addEventListener('click', logout);
  $('#addBtn').addEventListener('click', () => openRecordModal(null));
  $('#photoAddBtn').addEventListener('click', () => $('#photoInput').click());
  $('#photoInput').addEventListener('change', handlePhotoInput);
  $('#recordForm').addEventListener('submit', handleRecordSave);

  document.querySelectorAll('.view-tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));

  document.querySelectorAll('#starPicker button').forEach((b) => {
    b.addEventListener('click', () => { pendingRating = Number(b.dataset.v); renderStarPicker(); });
  });
  document.querySelectorAll('#visPicker .vis-btn').forEach((b) => {
    b.addEventListener('click', () => { pendingVis = b.dataset.vis; renderVisPicker(); });
  });

  document.querySelectorAll('[data-close]').forEach((b) => {
    b.addEventListener('click', () => closeModal(b.dataset.close));
  });
  document.querySelectorAll('.modal-overlay').forEach((ov) => {
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) closeModal(ov.id); });
  });

  const { data: { session } } = await sb.auth.getSession();
  if (session) enterMain(session.user);
}

init();
