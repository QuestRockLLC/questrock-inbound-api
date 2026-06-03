-- LO desk: search mailer leads, assign LO, history, weekly mail PDF + call script.

alter table public.mailer_leads
  add column if not exists assigned_lo_name text,
  add column if not exists assigned_at timestamptz;

create index if not exists mailer_leads_assigned_lo_name_key
  on public.mailer_leads (assigned_lo_name)
  where assigned_lo_name is not null;

create index if not exists mailer_leads_full_name_trgm_key
  on public.mailer_leads (full_name);

create index if not exists mailer_leads_address_line_1_key
  on public.mailer_leads (address_line_1);

create table if not exists public.mailer_lo_events (
  event_id uuid not null default gen_random_uuid(),
  mailer_lead_id uuid not null,
  reference_code text not null,
  event_type text not null,
  lo_name text,
  details jsonb,
  created_at timestamptz default now(),
  constraint mailer_lo_events_pkey primary key (event_id),
  constraint mailer_lo_events_mailer_lead_id_fkey
    foreign key (mailer_lead_id) references public.mailer_leads (mailer_lead_id)
);

create index if not exists mailer_lo_events_mailer_lead_id_key
  on public.mailer_lo_events (mailer_lead_id, created_at desc);

create table if not exists public.mailer_campaigns (
  campaign_id uuid not null default gen_random_uuid(),
  week_label text not null,
  mail_drop_date date,
  pdf_url text,
  script_markdown text,
  is_active boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint mailer_campaigns_pkey primary key (campaign_id)
);

create unique index if not exists mailer_campaigns_week_label_key
  on public.mailer_campaigns (week_label);
