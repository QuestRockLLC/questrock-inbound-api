-- Active mailer campaign row for this week's letters + First Call Flow script.
-- Set pdf_url after uploading the week's mail PDF (Vercel env or UPDATE below).

update public.mailer_campaigns
set is_active = false
where is_active = true;

insert into public.mailer_campaigns (
  week_label,
  mail_drop_date,
  pdf_url,
  script_markdown,
  is_active,
  updated_at
)
values (
  'June 2026 — QuestMail drop',
  current_date,
  null,
  null,
  true,
  now()
)
on conflict (week_label) do update
set
  is_active = true,
  mail_drop_date = excluded.mail_drop_date,
  updated_at = now();
