-- Align AI + Supabase status_definitions with Shape's 5-status picklist.
-- Safe on DBs where leads.current_status_label was never added.

-- Seed the five allowed statuses first (needed before FK updates on leads).
INSERT INTO public.status_definitions (status_label, color, description, priority)
VALUES
  ('Advanced', '#1a7a3e', 'Green — borrower moving forward (callback, app, docs, or commitment locked)', 1),
  ('Not Contacted', '#c2570a', 'Orange — voicemail, incomplete, or no substantive conversation', 2),
  ('Did Not Advance', '#c2570a', 'Orange — live call stalled with no locked next step or nurture hold', 3),
  ('Bad Lead', '#b91c1c', 'Red — wrong number, spam, or invalid contact', 4),
  ('Turndown', '#b91c1c', 'Red — not interested, DNC, or permanently dead', 5)
ON CONFLICT (status_label) DO UPDATE SET
  color = EXCLUDED.color,
  description = EXCLUDED.description,
  priority = EXCLUDED.priority;

-- Ensure leads has status columns (older Supabase projects may lack these).
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS current_status_label text,
  ADD COLUMN IF NOT EXISTS current_status_color text;

ALTER TABLE public.transcripts
  ADD COLUMN IF NOT EXISTS ai_status_label text,
  ADD COLUMN IF NOT EXISTS ai_status_color text;

-- Forward-progress / pipeline statuses → Advanced (transcripts)
UPDATE public.transcripts
SET ai_status_label = 'Advanced'
WHERE ai_status_label IN (
  'First Call Appointment Scheduled',
  'Pitch Appointment Scheduled',
  'Missed Appt - Rescheduling',
  'Missed Appt – Rescheduling',
  'Contacted',
  'App Sent',
  'App Started',
  'App Completed',
  'Verification Docs Requested',
  'Verification Docs Received',
  'Pitched & Waiting',
  'Pitched - Advance',
  'Pitched - Advance to eSign',
  'Package Out',
  'Package Signed Not Piped',
  'Piped',
  'Appraisal Received',
  'Pre-Qualified',
  'Pre-Approved',
  'Registered',
  'Processing',
  'Submitted to UW',
  'Approved with Conditions',
  'Conditions Submitted',
  'Incomplete (ReSubmission)',
  'Suspended',
  'Clear to Close',
  'Clear To Close',
  'Closed',
  'Funded',
  'Purchased',
  'In Shipping',
  'Post Closing',
  'Servicing',
  'New Lead',
  'New Lead – Reapplied',
  'New Lead - Reapplied',
  'VISIT',
  'VISIT–Bounced',
  'Callback scheduled',
  'Application completed · Pitch scheduled'
);

-- Nurture / stalled / hold → Did Not Advance (transcripts)
UPDATE public.transcripts
SET ai_status_label = 'Did Not Advance'
WHERE ai_status_label IN (
  'Long Term Nurture',
  'No Response – Ghosted',
  'Contract Received',
  'Bad Contact Info',
  'Help Requested'
);

-- Do Not Call → Turndown (transcripts)
UPDATE public.transcripts
SET ai_status_label = 'Turndown'
WHERE ai_status_label IN ('Do Not Call List', 'Denied after Piped', 'Withdrawn', 'Not Accepted');

-- Catch-all legacy transcript labels
UPDATE public.transcripts
SET ai_status_label = 'Did Not Advance'
WHERE ai_status_label IS NOT NULL
  AND ai_status_label NOT IN (
    'Advanced',
    'Not Contacted',
    'Did Not Advance',
    'Bad Lead',
    'Turndown'
  );

-- Forward-progress / pipeline statuses → Advanced (leads)
UPDATE public.leads
SET current_status_label = 'Advanced'
WHERE current_status_label IN (
  'First Call Appointment Scheduled',
  'Pitch Appointment Scheduled',
  'Missed Appt - Rescheduling',
  'Missed Appt – Rescheduling',
  'Contacted',
  'App Sent',
  'App Started',
  'App Completed',
  'Verification Docs Requested',
  'Verification Docs Received',
  'Pitched & Waiting',
  'Pitched - Advance',
  'Pitched - Advance to eSign',
  'Package Out',
  'Package Signed Not Piped',
  'Piped',
  'Appraisal Received',
  'Pre-Qualified',
  'Pre-Approved',
  'Registered',
  'Processing',
  'Submitted to UW',
  'Approved with Conditions',
  'Conditions Submitted',
  'Incomplete (ReSubmission)',
  'Suspended',
  'Clear to Close',
  'Clear To Close',
  'Closed',
  'Funded',
  'Purchased',
  'In Shipping',
  'Post Closing',
  'Servicing',
  'New Lead',
  'New Lead – Reapplied',
  'New Lead - Reapplied',
  'VISIT',
  'VISIT–Bounced',
  'Callback scheduled',
  'Application completed · Pitch scheduled'
);

-- Nurture / stalled / hold → Did Not Advance (leads)
UPDATE public.leads
SET current_status_label = 'Did Not Advance'
WHERE current_status_label IN (
  'Long Term Nurture',
  'No Response – Ghosted',
  'Contract Received',
  'Bad Contact Info',
  'Help Requested'
);

-- Do Not Call → Turndown (leads)
UPDATE public.leads
SET current_status_label = 'Turndown'
WHERE current_status_label IN ('Do Not Call List', 'Denied after Piped', 'Withdrawn', 'Not Accepted');

-- Catch-all legacy lead labels
UPDATE public.leads
SET current_status_label = 'Did Not Advance'
WHERE current_status_label IS NOT NULL
  AND current_status_label NOT IN (
    'Advanced',
    'Not Contacted',
    'Did Not Advance',
    'Bad Lead',
    'Turndown'
  );

-- Drop FK if it blocks deleting old status rows, then re-add after cleanup.
ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_current_status_label_fkey;

DELETE FROM public.status_definitions
WHERE status_label NOT IN (
  'Advanced',
  'Not Contacted',
  'Did Not Advance',
  'Bad Lead',
  'Turndown'
);

ALTER TABLE public.leads
  ADD CONSTRAINT leads_current_status_label_fkey
  FOREIGN KEY (current_status_label)
  REFERENCES public.status_definitions (status_label);
