create extension if not exists pgcrypto;

create table if not exists public.providers (
  slug text primary key,
  name text not null,
  bank_name text not null,
  country text not null,
  source_url text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.scraping_runs (
  id uuid primary key default gen_random_uuid(),
  provider_slug text not null references public.providers(slug) on delete cascade,
  status text not null,
  raw_count integer not null default 0,
  normalized_count integer not null default 0,
  valid_count integer not null default 0,
  needs_review_count integer not null default 0,
  invalid_count integer not null default 0,
  output_path text,
  started_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.benefits (
  id uuid primary key default gen_random_uuid(),
  provider_slug text not null references public.providers(slug) on delete cascade,
  provider_benefit_key text not null,
  bank_name text not null,
  merchant_name text not null,
  merchant_canonical_name text not null,
  merchant_slug text not null,
  merchant_source text not null,
  merchant_matched_alias text,
  category_name text not null,
  category_source text not null,
  title text not null,
  benefit_type text not null,
  benefit_value numeric,
  benefit_value_unit text not null,
  days jsonb,
  channel jsonb,
  payment_methods jsonb,
  cap_amount numeric,
  terms_text text,
  source_url text not null,
  redirect_url text,
  image_url text,
  logo_url text,
  raw_title text,
  raw_category text,
  raw_merchant text,
  raw_text text not null,
  raw_metadata jsonb not null default '{}'::jsonb,
  confidence_score numeric not null,
  validation_status text not null,
  validation_errors jsonb not null default '[]'::jsonb,
  first_seen_at timestamptz not null default timezone('utc', now()),
  last_seen_at timestamptz not null default timezone('utc', now()),
  last_scraped_at timestamptz not null default timezone('utc', now()),
  is_active boolean not null default true,
  last_run_id uuid references public.scraping_runs(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint benefits_provider_slug_provider_benefit_key_key unique (provider_slug, provider_benefit_key)
);

create index if not exists benefits_provider_slug_idx on public.benefits(provider_slug);
create index if not exists benefits_provider_slug_is_active_idx on public.benefits(provider_slug, is_active);
create index if not exists benefits_merchant_slug_idx on public.benefits(merchant_slug);
create index if not exists benefits_category_name_idx on public.benefits(category_name);
create index if not exists scraping_runs_provider_slug_idx on public.scraping_runs(provider_slug);

alter table public.providers enable row level security;
alter table public.scraping_runs enable row level security;
alter table public.benefits enable row level security;

drop policy if exists "providers_public_read" on public.providers;
create policy "providers_public_read"
on public.providers
for select
to anon, authenticated
using (true);

drop policy if exists "benefits_public_read_active" on public.benefits;
create policy "benefits_public_read_active"
on public.benefits
for select
to anon, authenticated
using (is_active = true and validation_status <> 'invalid');
