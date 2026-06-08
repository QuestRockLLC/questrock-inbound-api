-- Historical Shape lead archive (bulk export + notes enrich) for stalled-loan search / chatbot

create table if not exists public.shape_archive_batches (
  batch_id uuid primary key default gen_random_uuid(),
  batch_label text,
  date_from date not null,
  date_to date not null,
  source_filters text[] not null default '{}',
  status text not null default 'pending',
  bulk_last_page integer not null default 0,
  bulk_leads_seen integer not null default 0,
  bulk_leads_matched integer not null default 0,
  enrich_done integer not null default 0,
  enrich_failed integer not null default 0,
  notes_count integer not null default 0,
  error_summary text,
  config jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists shape_archive_batches_created_at_idx
  on public.shape_archive_batches (created_at desc);

create table if not exists public.shape_archive_leads (
  archive_lead_id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.shape_archive_batches (batch_id) on delete cascade,
  shape_lead_id text not null,
  lead_id uuid references public.leads (lead_id),
  lead_source text,
  mstrstatus1 text,
  full_name text,
  phone text,
  email text,
  bulk_fields jsonb not null default '{}'::jsonb,
  shape_fields jsonb,
  notes_sidebar text,
  notes_sidebar_ai_note text,
  recent_notes text,
  enrich_status text not null default 'pending',
  enrich_error text,
  enriched_at timestamptz,
  archived_at timestamptz not null default now(),
  unique (batch_id, shape_lead_id)
);

create index if not exists shape_archive_leads_shape_lead_id_idx
  on public.shape_archive_leads (shape_lead_id);

create index if not exists shape_archive_leads_batch_enrich_idx
  on public.shape_archive_leads (batch_id, enrich_status);

create index if not exists shape_archive_leads_lead_source_idx
  on public.shape_archive_leads (lead_source);

create index if not exists shape_archive_leads_mstrstatus1_idx
  on public.shape_archive_leads (mstrstatus1);

create table if not exists public.shape_archive_notes (
  archive_note_id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.shape_archive_batches (batch_id) on delete cascade,
  archive_lead_id uuid references public.shape_archive_leads (archive_lead_id) on delete cascade,
  shape_lead_id text not null,
  lead_id uuid references public.leads (lead_id),
  note_source text not null,
  note_text text not null,
  note_html text,
  call_source text,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  noted_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists shape_archive_notes_external_id_idx
  on public.shape_archive_notes (external_id)
  where external_id is not null;

create index if not exists shape_archive_notes_shape_lead_id_idx
  on public.shape_archive_notes (shape_lead_id, noted_at desc);

create index if not exists shape_archive_notes_batch_id_idx
  on public.shape_archive_notes (batch_id);
