-- Run once in Supabase SQL editor if shape_lead_id is not on leads yet.
alter table public.leads
  add column if not exists shape_lead_id text;

create unique index if not exists leads_shape_lead_id_key
  on public.leads (shape_lead_id)
  where shape_lead_id is not null;

alter table public.transcripts
  add column if not exists external_call_id text;

create unique index if not exists transcripts_external_call_id_key
  on public.transcripts (external_call_id)
  where external_call_id is not null;
