alter table public.mailer_leads
  add column if not exists curr_pay_date text,
  add column if not exists new_pay_date text;
