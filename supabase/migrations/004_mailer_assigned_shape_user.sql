alter table public.mailer_leads
  add column if not exists assigned_shape_user_id integer;
