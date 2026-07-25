# Deny list — transcript & SSN/DOB must never appear here

Enforced in code via `lib/deal-review/deny-list.js`.

## Shape fields

- `notes_sidebar`
- `notes_sidebar_ai_note`
- `recent_notes`
- `game_plan_notes`
- Any field populated by `syncShapeLeadFromEvaluation` except approved CRM keys in `field-catalog.js`
- Deal Review field — structured summary only; no raw transcript or SSN/DOB

## Outbound channels

- Admin email body (`lib/admin-email.js`) — no transcript body; no SSN/DOB
- QuestMail reports
- Shape archive import (`lib/shape/archive.js`) — no transcript text in archive notes
- OpenAI prompts persisted in `fields_populated`
- Error messages returned to Call Tracker UI

## Logging & audit

- Application logs — never log raw SSN or DOB values
- `fields_populated.private_identity` — verification flags only, never raw digits

## AI prompts

- General evaluation and Deal Review prompts receive **redacted** transcript text (SSN/DOB stripped before OpenAI)
