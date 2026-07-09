-- Align status_definitions copy with interest-based Advanced (not calendar-locked).

UPDATE public.status_definitions
SET description = 'Green — borrower interested with forward motion (app/docs, follow-up, callback, or pipeline progress)'
WHERE status_label = 'Advanced';

UPDATE public.status_definitions
SET description = 'Orange — live call stalled: no interest path, long nurture only, or disengaged'
WHERE status_label = 'Did Not Advance';
