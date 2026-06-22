create table if not exists public.shape_sync_watermark (
  key text primary key,
  value timestamptz not null,
  updated_at timestamptz default now()
);
