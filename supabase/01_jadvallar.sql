-- OverlayLab: ma'lumotlar bazasi tuzilmasi (Supabase → SQL Editor → shu faylni to'liq qo'yib RUN bosing)

-- 1) Hujjatlar jadvali: har bir yozuv = bitta hujjat (hudud, shahar, sozlama, jurnal yozuvi)
create table if not exists public.docs (
  path        text primary key,              -- masalan: hududlar/UZ-JI
  coll        text not null,                 -- masalan: hududlar
  data        jsonb not null default '{}',   -- {"nomi": "...", "aholi": 1545176, ...}
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create index if not exists docs_coll_idx on public.docs (coll);

-- 2) Administratorlar ro'yxati (faqat shular ma'lumot o'zgartira oladi)
create table if not exists public.admins (email text primary key);

-- 3) Joriy foydalanuvchi administratormi?
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where lower(email) = lower(auth.jwt() ->> 'email'))
$$;
grant execute on function public.is_admin() to anon, authenticated;

-- 4) Xavfsizlik qoidalari (RLS): hamma o'qiydi, faqat admin yozadi
alter table public.docs   enable row level security;
alter table public.admins enable row level security;
drop policy if exists "hamma oqiydi"     on public.docs;
drop policy if exists "admin qoshadi"    on public.docs;
drop policy if exists "admin yangilaydi" on public.docs;
drop policy if exists "admin ochiradi"   on public.docs;
create policy "hamma oqiydi"     on public.docs for select using (true);
create policy "admin qoshadi"    on public.docs for insert with check (public.is_admin());
create policy "admin yangilaydi" on public.docs for update using (public.is_admin()) with check (public.is_admin());
create policy "admin ochiradi"   on public.docs for delete using (public.is_admin());

-- 5) Jonli yangilanish (Realtime): o'zgarish barcha brauzerlarga darhol boradi
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- 6) O'ZINGIZNING EMAILINGIZNI YOZING (Authentication → Users da yaratgan foydalanuvchi emaili):
insert into public.admins (email) values ('SIZNING_EMAIL@gmail.com') on conflict do nothing;
