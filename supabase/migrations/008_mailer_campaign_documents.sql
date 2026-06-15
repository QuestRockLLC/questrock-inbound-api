-- Multiple letter PDFs per mail drop (e.g. FHA Cash Out + FHA Streamline proofs).

alter table public.mailer_campaigns
  add column if not exists mail_documents jsonb;

comment on column public.mailer_campaigns.mail_documents is
  'Array of { label, pdf_url, source_file?, proof_copies? } for LO desk mail tab.';

update public.mailer_campaigns
set
  mail_documents = '[
    {
      "label": "Letter 1 — FHA Cash Out",
      "pdf_url": "/mailer-mail/06112026/letter-1-fha-cash-out.pdf",
      "source_file": "Camber Questrock ITA public record proofs 06112026.pdf",
      "proof_copies": 2
    },
    {
      "label": "Letter 2 — FHA Streamline",
      "pdf_url": "/mailer-mail/06112026/letter-2-fha-streamline.pdf",
      "source_file": "Camber Questrock Internet inquiry record proofs 06112026.pdf",
      "proof_copies": 2
    }
  ]'::jsonb,
  week_label = 'June 11, 2026 — QuestMail (FHA Cash Out + Streamline)',
  mail_drop_date = '2026-06-11',
  updated_at = now()
where is_active = true;
