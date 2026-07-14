-- 여자친구 음식 자랑 대회 — Supabase 스키마

create table if not exists public.records (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  owner_email text not null,
  title text not null,
  date date not null,
  descr text not null default '',
  rating int not null check (rating between 1 and 5),
  photos jsonb not null default '[]',
  is_public boolean not null default false,
  best_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.records enable row level security;

drop policy if exists "read own or public" on public.records;
create policy "read own or public" on public.records
  for select using (is_public or auth.uid() = owner);

drop policy if exists "insert own" on public.records;
create policy "insert own" on public.records
  for insert with check (auth.uid() = owner);

drop policy if exists "update own" on public.records;
create policy "update own" on public.records
  for update using (auth.uid() = owner);

drop policy if exists "delete own" on public.records;
create policy "delete own" on public.records
  for delete using (auth.uid() = owner);

create index if not exists records_owner_idx on public.records(owner);
create index if not exists records_public_idx on public.records(is_public) where is_public;

-- 사진 저장 버킷 (공개 읽기)
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

drop policy if exists "photo read" on storage.objects;
create policy "photo read" on storage.objects
  for select using (bucket_id = 'photos');

drop policy if exists "photo upload own" on storage.objects;
create policy "photo upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "photo delete own" on storage.objects;
create policy "photo delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
