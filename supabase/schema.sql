-- QuestRock inbound pipeline — matches live Supabase (context reference).

create table if not exists public.status_definitions (
  status_label text not null,
  color text,
  description text,
  priority integer,
  constraint status_definitions_pkey primary key (status_label)
);

create table if not exists public.leads (
  lead_id uuid not null default gen_random_uuid(),
  full_name text,
  phone_number text unique,
  email text,
  current_address text,
  city text,
  state text,
  zip_code text,
  company_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  current_status_color text,
  current_status_label text,
  shape_lead_id text,
  constraint leads_pkey primary key (lead_id),
  constraint leads_current_status_label_fkey
    foreign key (current_status_label) references public.status_definitions (status_label)
);

create unique index if not exists leads_shape_lead_id_key on public.leads (shape_lead_id);

create table if not exists public.transcripts (
  transcript_id uuid not null default gen_random_uuid(),
  lead_id uuid,
  call_source text,
  transcript_text text,
  timestamp timestamptz default now(),
  hash text,
  previous_hash text,
  ai_status_color text,
  ai_status_label text,
  fields_populated jsonb,
  external_call_id text,
  constraint transcripts_pkey primary key (transcript_id),
  constraint transcripts_lead_id_fkey foreign key (lead_id) references public.leads (lead_id)
);

create unique index if not exists transcripts_external_call_id_key
  on public.transcripts (external_call_id)
  where external_call_id is not null;

create index if not exists transcripts_lead_id_key on public.transcripts (lead_id);

-- See supabase/migrations/002_mailer_leads.sql and 003_mailer_lo_desk.sql for mailer tables.
