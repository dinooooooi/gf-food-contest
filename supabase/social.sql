-- 2차 확장: 커플 연동 + 하트 리액션 + 댓글

-- ───────── 커플 연동 ─────────
create table if not exists public.couples (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  a uuid not null references auth.users(id) on delete cascade,
  a_email text not null,
  b uuid references auth.users(id) on delete cascade,
  b_email text,
  created_at timestamptz not null default now()
);

alter table public.couples enable row level security;

drop policy if exists "couples own" on public.couples;
create policy "couples own" on public.couples
  for select using (auth.uid() = a or auth.uid() = b);

-- 내 파트너의 uuid (연동 완료된 경우만)
create or replace function public.my_partner() returns uuid
language sql stable security definer set search_path = public as $$
  select case when a = auth.uid() then b else a end
  from couples
  where (a = auth.uid() or b = auth.uid()) and b is not null
  limit 1;
$$;

-- 커플 코드 만들기 (기존 미사용 코드는 새로 발급하면 교체)
create or replace function public.create_couple_code() returns text
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  if exists (select 1 from couples where (a = auth.uid() or b = auth.uid()) and b is not null) then
    raise exception '이미 커플 연동이 되어 있어요! 먼저 해제해 주세요';
  end if;
  delete from couples where a = auth.uid() and b is null;
  v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  insert into couples (code, a, a_email)
  values (v_code, auth.uid(), (select email from auth.users where id = auth.uid()));
  return v_code;
end $$;

-- 상대방 코드로 연동하기 (성공 시 상대 이메일 반환)
create or replace function public.join_couple(p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare v couples;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  if exists (select 1 from couples where (a = auth.uid() or b = auth.uid()) and b is not null) then
    raise exception '이미 커플 연동이 되어 있어요! 먼저 해제해 주세요';
  end if;
  select * into v from couples where code = upper(trim(p_code)) and b is null;
  if not found then raise exception '코드를 찾을 수 없어요. 다시 확인해 주세요!'; end if;
  if v.a = auth.uid() then raise exception '자기 자신과는 연동할 수 없어요 (>_<)'; end if;
  delete from couples where a = auth.uid() and b is null;
  update couples
  set b = auth.uid(), b_email = (select email from auth.users where id = auth.uid())
  where id = v.id;
  return v.a_email;
end $$;

-- 연동 해제 (미사용 코드도 함께 정리)
create or replace function public.unlink_couple() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from couples where a = auth.uid() or b = auth.uid();
end $$;

-- 파트너는 나만보기 기록도 볼 수 있게 조회 정책 교체
drop policy if exists "read own or public" on public.records;
create policy "read own or public" on public.records
  for select using (is_public or auth.uid() = owner or owner = public.my_partner());

-- ───────── 하트 리액션 ─────────
create table if not exists public.reactions (
  record_id uuid not null references public.records(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (record_id, user_id)
);

alter table public.reactions enable row level security;

drop policy if exists "reactions read" on public.reactions;
create policy "reactions read" on public.reactions
  for select using (exists (select 1 from records r where r.id = record_id));

drop policy if exists "reactions insert" on public.reactions;
create policy "reactions insert" on public.reactions
  for insert with check (auth.uid() = user_id and exists (select 1 from records r where r.id = record_id));

drop policy if exists "reactions delete" on public.reactions;
create policy "reactions delete" on public.reactions
  for delete using (auth.uid() = user_id);

-- ───────── 댓글 ─────────
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.records(id) on delete cascade,
  author uuid not null references auth.users(id) on delete cascade,
  author_email text not null,
  content text not null check (char_length(content) between 1 and 500),
  created_at timestamptz not null default now()
);

alter table public.comments enable row level security;

drop policy if exists "comments read" on public.comments;
create policy "comments read" on public.comments
  for select using (exists (select 1 from records r where r.id = record_id));

drop policy if exists "comments insert" on public.comments;
create policy "comments insert" on public.comments
  for insert with check (auth.uid() = author and exists (select 1 from records r where r.id = record_id));

-- 삭제: 댓글 작성자 본인 또는 글쓴이
drop policy if exists "comments delete" on public.comments;
create policy "comments delete" on public.comments
  for delete using (
    auth.uid() = author
    or auth.uid() = (select owner from records r where r.id = record_id)
  );

create index if not exists comments_record_idx on public.comments(record_id);
