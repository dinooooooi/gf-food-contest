/* ═══════════ 여자친구 음식 자랑 대회 ═══════════ */

const ADMIN_EMAIL = 'savntew@gmail.com';
const USERS_KEY = 'gffc_users';
const SESSION_KEY = 'gffc_session';
const BEST_LIMIT = 3;

const $ = (sel) => document.querySelector(sel);

/* ───────── IndexedDB ───────── */

let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('gffcDB', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('records', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbPut(record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite');
    tx.objectStore('records').put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function dbDelete(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite');
    tx.objectStore('records').delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function dbGetAll() {
  return new Promise((resolve, reject) => {
    const req = db.transaction('records', 'readonly').objectStore('records').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ───────── 유틸 ───────── */

async function hashPw(pw) {
  if (crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('gffc!' + pw));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // crypto.subtle이 없는 환경(file:// 등)용 단순 해시
  let h = 0;
  const s = 'gffc!' + pw;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return 'x' + (h >>> 0).toString(16);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDate(iso) {
  return iso ? iso.replaceAll('-', '.') : '';
}

function starHtml(rating, cls) {
  let s = '';
  for (let i = 1; i <= 5; i++) s += `<span class="${i <= rating ? '' : 'off'}">★</span>`;
  return `<span class="${cls}">${s}</span>`;
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

/* Object URL 관리 (렌더링마다 정리) */
let liveUrls = [];
function blobUrl(blob) {
  const u = URL.createObjectURL(blob);
  liveUrls.push(u);
  return u;
}
function revokeAll() {
  liveUrls.forEach((u) => URL.revokeObjectURL(u));
  liveUrls = [];
}

/* ───────── 인증 ───────── */

function getUsers() {
  try { return JSON.parse(localStorage.getItem(USERS_KEY)) || {}; } catch { return {}; }
}
function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}
function session() {
  return localStorage.getItem(SESSION_KEY);
}
function isAdmin() {
  return session() === ADMIN_EMAIL;
}

let authMode = 'login';

function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll('.auth-tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === mode));
  $('#authSubmit').textContent = mode === 'login' ? '로그인 ♥' : '회원가입 ♥';
  $('#authError').textContent = '';
}

async function handleAuth(e) {
  e.preventDefault();
  const email = $('#authEmail').value.trim().toLowerCase();
  const pw = $('#authPw').value;
  const users = getUsers();
  const err = $('#authError');
  err.textContent = '';

  const pwHash = await hashPw(pw);

  if (authMode === 'signup') {
    if (users[email]) { err.textContent = '이미 가입된 이메일이에요!'; return; }
    users[email] = { pwHash, joined: Date.now() };
    saveUsers(users);
  } else {
    if (!users[email]) { err.textContent = '가입되지 않은 이메일이에요. 회원가입을 먼저 해주세요!'; return; }
    if (users[email].pwHash !== pwHash) { err.textContent = '비밀번호가 틀렸어요 (>_<)'; return; }
  }

  localStorage.setItem(SESSION_KEY, email);
  $('#authPw').value = '';
  enterMain();
}

function logout() {
  localStorage.removeItem(SESSION_KEY);
  $('#mainScreen').classList.add('hidden');
  $('#authScreen').classList.remove('hidden');
}

/* ───────── 메인 렌더링 ───────── */

let records = [];

async function refresh() {
  records = await dbGetAll();
  render();
}

function enterMain() {
  const email = session();
  $('#authScreen').classList.add('hidden');
  $('#mainScreen').classList.remove('hidden');
  $('#userChip').innerHTML = (isAdmin() ? '<span class="admin-mark">👑 관리자</span> · ' : '♥ ') + escapeHtml(email);
  refresh();
}

function render() {
  revokeAll();
  renderBest();
  renderList();
}

function bestRecords() {
  return records.filter((r) => r.best).sort((a, b) => (a.bestAt || 0) - (b.bestAt || 0)).slice(0, BEST_LIMIT);
}

function renderBest() {
  const grid = $('#bestGrid');
  const best = bestRecords();
  const medals = ['🥇', '🥈', '🥉'];
  grid.innerHTML = '';

  for (let i = 0; i < BEST_LIMIT; i++) {
    const r = best[i];
    const card = document.createElement('div');
    if (r) {
      card.className = 'best-card';
      const photo = r.photos && r.photos[0]
        ? `<img class="best-photo" src="${blobUrl(r.photos[0])}" alt="">`
        : '<div class="best-photo-empty">🍽️</div>';
      card.innerHTML = `<span class="best-rank">${medals[i]}</span>${photo}<div class="best-name">${escapeHtml(r.title)}</div>`;
      card.addEventListener('click', () => openDetail(r.id));
    } else {
      card.className = 'best-card best-empty';
      card.innerHTML = `<span class="best-rank">${medals[i]}</span><div class="best-photo-empty">✨</div><div class="best-name">비어있어요</div>`;
    }
    grid.appendChild(card);
  }
}

function renderList() {
  const list = $('#recordList');
  const sorted = [...records].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
  $('#recordCount').textContent = sorted.length + '개';
  list.innerHTML = '';

  if (!sorted.length) {
    list.innerHTML = '<div class="record-empty">아직 기록이 없어요 (´•̥ ω •̥`)<br>오른쪽 아래 <b>＋</b> 버튼으로 첫 요리를 자랑해 주세요!</div>';
    return;
  }

  sorted.forEach((r) => {
    const card = document.createElement('div');
    card.className = 'record-card';
    const thumb = r.photos && r.photos[0]
      ? `<img class="record-thumb" src="${blobUrl(r.photos[0])}" alt="">`
      : '<div class="record-thumb-empty">🍽️</div>';
    card.innerHTML = `
      ${thumb}
      <div class="record-info">
        <div class="record-head">
          <span class="record-name">${escapeHtml(r.title)}</span>
          ${r.best ? '<span class="record-best-badge">👑 BEST</span>' : ''}
        </div>
        <div class="record-date">📅 ${fmtDate(r.date)}</div>
        <div class="record-desc">${escapeHtml(r.desc)}</div>
        <div class="record-stars">${starHtml(r.rating, '')}</div>
      </div>`;
    card.addEventListener('click', () => openDetail(r.id));
    list.appendChild(card);
  });
}

/* ───────── 기록 추가/수정 모달 ───────── */

let editingId = null;
let pendingPhotos = [];
let pendingRating = 0;

function openRecordModal(record) {
  editingId = record ? record.id : null;
  pendingPhotos = record ? [...(record.photos || [])] : [];
  pendingRating = record ? record.rating : 0;

  $('#recordModalTitle').textContent = record ? '요리 기록 수정 ♥' : '새 요리 기록 ♥';
  $('#recTitle').value = record ? record.title : '';
  $('#recDate').value = record ? record.date : new Date().toISOString().slice(0, 10);
  $('#recDesc').value = record ? record.desc : '';
  renderPhotoPreview();
  renderStarPicker();
  $('#recordModal').classList.remove('hidden');
}

function renderPhotoPreview() {
  const box = $('#photoPreview');
  box.innerHTML = '';
  pendingPhotos.forEach((blob, i) => {
    const cell = document.createElement('div');
    cell.className = 'photo-cell';
    cell.innerHTML = `<img src="${URL.createObjectURL(blob)}" alt=""><button type="button" class="photo-del">✕</button>`;
    cell.querySelector('.photo-del').addEventListener('click', () => {
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

async function handlePhotoInput(e) {
  const files = [...e.target.files];
  e.target.value = '';
  for (const f of files) {
    try {
      pendingPhotos.push(await compressImage(f));
    } catch {
      alert('사진 하나를 읽지 못했어요 (>_<)');
    }
  }
  renderPhotoPreview();
}

async function handleRecordSave(e) {
  e.preventDefault();
  if (!pendingRating) { alert('별점을 매겨주세요! ⭐'); return; }

  const existing = editingId ? records.find((r) => r.id === editingId) : null;
  const record = {
    id: editingId || crypto.randomUUID(),
    title: $('#recTitle').value.trim(),
    date: $('#recDate').value,
    desc: $('#recDesc').value.trim(),
    rating: pendingRating,
    photos: pendingPhotos,
    best: existing ? existing.best : false,
    bestAt: existing ? existing.bestAt : 0,
    owner: existing ? existing.owner : session(),
    createdAt: existing ? existing.createdAt : Date.now(),
  };
  await dbPut(record);
  closeModal('recordModal');
  refresh();
}

/* ───────── 상세 보기 ───────── */

function openDetail(id) {
  const r = records.find((x) => x.id === id);
  if (!r) return;

  $('#detailTitle').textContent = r.title;
  const canEdit = isAdmin() || r.owner === session();

  const photos = (r.photos || []).map((b) => `<img src="${blobUrl(b)}" alt="">`).join('');
  const actions = [];
  if (isAdmin()) {
    actions.push(`<button type="button" class="btn-best" id="detailBestBtn">${r.best ? '👑 BEST 해제' : '👑 BEST 지정'}</button>`);
  }
  if (canEdit) {
    actions.push('<button type="button" class="btn-gray" id="detailEditBtn">✏️ 수정</button>');
    actions.push('<button type="button" class="btn-danger" id="detailDelBtn">🗑 삭제</button>');
  }

  $('#detailBody').innerHTML = `
    ${photos ? `<div class="detail-photos">${photos}</div>` : ''}
    <div class="detail-meta">
      <span class="detail-date">📅 ${fmtDate(r.date)}</span>
      ${starHtml(r.rating, 'detail-stars')}
    </div>
    ${r.desc ? `<div class="detail-desc">${escapeHtml(r.desc)}</div>` : ''}
    <div class="detail-owner">작성: ${escapeHtml(r.owner)}${r.best ? ' · 👑 BEST' : ''}</div>
    ${actions.length ? `<div class="detail-actions">${actions.join('')}</div>` : ''}`;

  const bestBtn = $('#detailBestBtn');
  if (bestBtn) bestBtn.addEventListener('click', () => toggleBest(r));
  const editBtn = $('#detailEditBtn');
  if (editBtn) editBtn.addEventListener('click', () => { closeModal('detailModal'); openRecordModal(r); });
  const delBtn = $('#detailDelBtn');
  if (delBtn) delBtn.addEventListener('click', async () => {
    if (!confirm(`"${r.title}" 기록을 삭제할까요?`)) return;
    await dbDelete(r.id);
    closeModal('detailModal');
    refresh();
  });

  $('#detailModal').classList.remove('hidden');
}

async function toggleBest(r) {
  if (!r.best && bestRecords().length >= BEST_LIMIT) {
    alert(`BEST는 ${BEST_LIMIT}개까지만! 먼저 하나를 해제해 주세요 👑`);
    return;
  }
  r.best = !r.best;
  r.bestAt = r.best ? Date.now() : 0;
  await dbPut(r);
  closeModal('detailModal');
  refresh();
}

/* ───────── 모달 공통 ───────── */

function closeModal(id) {
  $('#' + id).classList.add('hidden');
}

/* ───────── 초기화 ───────── */

async function init() {
  db = await openDB();

  document.querySelectorAll('.auth-tab').forEach((t) => t.addEventListener('click', () => setAuthMode(t.dataset.mode)));
  $('#authForm').addEventListener('submit', handleAuth);
  $('#logoutBtn').addEventListener('click', logout);
  $('#addBtn').addEventListener('click', () => openRecordModal(null));
  $('#photoAddBtn').addEventListener('click', () => $('#photoInput').click());
  $('#photoInput').addEventListener('change', handlePhotoInput);
  $('#recordForm').addEventListener('submit', handleRecordSave);

  document.querySelectorAll('#starPicker button').forEach((b) => {
    b.addEventListener('click', () => { pendingRating = Number(b.dataset.v); renderStarPicker(); });
  });

  document.querySelectorAll('[data-close]').forEach((b) => {
    b.addEventListener('click', () => closeModal(b.dataset.close));
  });
  document.querySelectorAll('.modal-overlay').forEach((ov) => {
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) ov.classList.add('hidden'); });
  });

  if (session()) enterMain();
}

init();
