-- 3차 확장: 닉네임(프로필) + 이메일 비노출

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 20),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- 닉네임은 공개 표시명이라 누구나 읽기 가능 (이메일은 절대 노출 안 됨)
drop policy if exists "profiles read all" on public.profiles;
create policy "profiles read all" on public.profiles
  for select using (true);

drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles
  for update using (auth.uid() = id);

-- 커플 연동 시 상대 이메일 대신 닉네임을 돌려주도록 교체
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
  return coalesce((select nickname from profiles where id = v.a), '셰프');
end $$;
