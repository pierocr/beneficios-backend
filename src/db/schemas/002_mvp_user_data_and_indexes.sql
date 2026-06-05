create extension if not exists pg_trgm;

alter table public.benefits
  add column if not exists status text not null default 'active',
  add column if not exists valid_from date,
  add column if not exists valid_to date,
  add column if not exists region text,
  add column if not exists commune text,
  add column if not exists modality text;

update public.benefits
set status = case when is_active then 'active' else 'disabled' end
where status is null or status = '';

create index if not exists benefits_status_active_idx
  on public.benefits(status, is_active, validation_status, updated_at desc);
create index if not exists benefits_detail_slug_idx
  on public.benefits(provider_slug, merchant_slug)
  where is_active = true and validation_status <> 'invalid';
create index if not exists benefits_days_gin_idx on public.benefits using gin(days);
create index if not exists benefits_channel_gin_idx on public.benefits using gin(channel);
create index if not exists benefits_payment_methods_gin_idx on public.benefits using gin(payment_methods);
create index if not exists benefits_search_trgm_idx
  on public.benefits using gin((bank_name || ' ' || merchant_name || ' ' || merchant_canonical_name || ' ' || title) gin_trgm_ops);
create index if not exists benefits_region_commune_idx on public.benefits(region, commune);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.user_wallet_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  provider_slug text not null references public.providers(slug) on delete cascade,
  card_type text,
  created_at timestamptz not null default timezone('utc', now()),
  unique(user_id, provider_slug, card_type)
);

create table if not exists public.user_favorite_merchants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  merchant_slug text not null,
  merchant_name text not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique(user_id, merchant_slug)
);

create table if not exists public.user_saved_benefits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  benefit_id uuid references public.benefits(id) on delete cascade,
  provider_slug text not null,
  merchant_slug text not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique(user_id, provider_slug, merchant_slug)
);

create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.benefit_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null default auth.uid(),
  benefit_id uuid references public.benefits(id) on delete set null,
  provider_slug text,
  merchant_slug text,
  reason text not null,
  message text not null,
  contact_email text,
  status text not null default 'open',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists user_wallet_items_user_id_idx on public.user_wallet_items(user_id);
create index if not exists user_favorite_merchants_user_id_idx on public.user_favorite_merchants(user_id);
create index if not exists user_saved_benefits_user_id_idx on public.user_saved_benefits(user_id);
create index if not exists benefit_reports_user_id_idx on public.benefit_reports(user_id);
create index if not exists benefit_reports_status_idx on public.benefit_reports(status, created_at desc);

alter table public.profiles enable row level security;
alter table public.user_wallet_items enable row level security;
alter table public.user_favorite_merchants enable row level security;
alter table public.user_saved_benefits enable row level security;
alter table public.user_preferences enable row level security;
alter table public.benefit_reports enable row level security;

drop policy if exists "profiles_own_read" on public.profiles;
create policy "profiles_own_read" on public.profiles for select to authenticated using (auth.uid() = id);
drop policy if exists "profiles_own_upsert" on public.profiles;
create policy "profiles_own_upsert" on public.profiles for insert to authenticated with check (auth.uid() = id);
drop policy if exists "profiles_own_update" on public.profiles;
create policy "profiles_own_update" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "wallet_own_all" on public.user_wallet_items;
create policy "wallet_own_all" on public.user_wallet_items for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "favorite_merchants_own_all" on public.user_favorite_merchants;
create policy "favorite_merchants_own_all" on public.user_favorite_merchants for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "saved_benefits_own_all" on public.user_saved_benefits;
create policy "saved_benefits_own_all" on public.user_saved_benefits for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "preferences_own_all" on public.user_preferences;
create policy "preferences_own_all" on public.user_preferences for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "benefit_reports_own_read" on public.benefit_reports;
create policy "benefit_reports_own_read" on public.benefit_reports for select to authenticated using (auth.uid() = user_id);
drop policy if exists "benefit_reports_public_insert" on public.benefit_reports;
create policy "benefit_reports_public_insert" on public.benefit_reports for insert to anon, authenticated with check (user_id is null or auth.uid() = user_id);
