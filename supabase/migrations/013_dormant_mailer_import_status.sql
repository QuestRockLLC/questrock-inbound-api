-- QuestMail / mailer CSV imports default to Dormant (not active outreach yet).
INSERT INTO public.status_definitions (status_label, color, description, priority)
VALUES (
  'Dormant',
  '#64748b',
  'QuestMail import — in mailer pool, not yet in active LO outreach',
  6
)
ON CONFLICT (status_label) DO UPDATE SET
  color = EXCLUDED.color,
  description = EXCLUDED.description,
  priority = EXCLUDED.priority;
