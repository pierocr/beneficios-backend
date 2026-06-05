alter table public.benefits
  add column if not exists source_image_url text,
  add column if not exists cached_image_url text,
  add column if not exists image_storage_path text,
  add column if not exists image_status text not null default 'source',
  add column if not exists image_updated_at timestamptz,
  add column if not exists image_error text;

update public.benefits
set source_image_url = image_url
where source_image_url is null and image_url is not null;

create table if not exists public.benefit_images (
  id uuid primary key default gen_random_uuid(),
  provider_slug text not null references public.providers(slug) on delete cascade,
  provider_benefit_key text not null,
  merchant_slug text not null,
  benefit_id uuid references public.benefits(id) on delete cascade,
  image_kind text not null default 'banner',
  source_url text not null,
  storage_bucket text not null,
  storage_path text not null,
  public_url text not null,
  mime_type text,
  width integer,
  height integer,
  byte_size integer,
  original_byte_size integer,
  sha256 text,
  status text not null default 'cached',
  error_message text,
  last_checked_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique(provider_slug, provider_benefit_key, image_kind)
);

create index if not exists benefit_images_source_url_idx on public.benefit_images(source_url);
create index if not exists benefit_images_merchant_slug_idx on public.benefit_images(merchant_slug);
create index if not exists benefit_images_status_idx on public.benefit_images(status, updated_at desc);
create index if not exists benefits_image_status_idx on public.benefits(image_status, image_updated_at desc);

alter table public.benefit_images enable row level security;

drop policy if exists "benefit_images_public_read" on public.benefit_images;
create policy "benefit_images_public_read"
on public.benefit_images
for select
to anon, authenticated
using (status = 'cached');
