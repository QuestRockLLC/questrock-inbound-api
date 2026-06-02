-- Thursday mailer spreadsheet import (data partner weekly drop).

create table if not exists public.mailer_import_batches (
  batch_id uuid not null default gen_random_uuid(),
  batch_label text,
  row_count integer default 0,
  shape_synced_count integer default 0,
  db_upserted_count integer default 0,
  skipped_count integer default 0,
  error_count integer default 0,
  dry_run boolean default false,
  created_at timestamptz default now(),
  constraint mailer_import_batches_pkey primary key (batch_id)
);

create table if not exists public.mailer_leads (
  mailer_lead_id uuid not null default gen_random_uuid(),
  reference_code text not null,
  import_batch_id uuid not null,
  full_name text,
  first_name text,
  last_name text,
  address_line_1 text,
  address_line_2 text,
  city text,
  state text,
  zip_code text,
  county text,
  mtg_amount text,
  property_date text,
  lender text,
  loan_type text,
  rate_type text,
  new_rate text,
  new_apr text,
  debt_amount text,
  new_total_payment text,
  mail_date text,
  offer_expires text,
  phone text,
  email text,
  shape_lead_id text,
  lead_id uuid,
  raw_row jsonb,
  imported_at timestamptz default now(),
  shape_synced_at timestamptz,
  constraint mailer_leads_pkey primary key (mailer_lead_id),
  constraint mailer_leads_import_batch_id_fkey
    foreign key (import_batch_id) references public.mailer_import_batches (batch_id),
  constraint mailer_leads_lead_id_fkey
    foreign key (lead_id) references public.leads (lead_id)
);

create unique index if not exists mailer_leads_reference_code_key
  on public.mailer_leads (reference_code);

create index if not exists mailer_leads_import_batch_id_key
  on public.mailer_leads (import_batch_id);

create index if not exists mailer_leads_shape_lead_id_key
  on public.mailer_leads (shape_lead_id)
  where shape_lead_id is not null;

alter table public.leads
  add column if not exists reference_code text,
  add column if not exists lead_source text;

create unique index if not exists leads_reference_code_key
  on public.leads (reference_code)
  where reference_code is not null;
