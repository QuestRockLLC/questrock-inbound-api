# Deal Review v1

Structured deal intelligence for Shape CRM sync and Call Tracker display.

## Files

| File | Purpose |
|------|---------|
| [deal-review-v1.schema.json](./deal-review-v1.schema.json) | JSON Schema (documentation + validation reference) |
| [shape-field-mapping.md](./shape-field-mapping.md) | Shape API field env vars |
| [deny-list.md](./deny-list.md) | Surfaces that must never receive transcript or SSN/DOB |

## Runtime modules

- `lib/deal-review/schema.js` — validator + OpenAI response schema
- `lib/deal-review/generate-deal-review.js` — AI task (isolated from general eval)
- `lib/deal-review/build-shape-payload.js` — HTML for Shape custom field
- `lib/private-fields/extract-ssn-dob.js` — deterministic SSN/DOB extraction
- `lib/private-fields/sync-to-shape.js` — private field write path

## Flow

1. Raw transcript stored in Supabase
2. SSN/DOB extracted → private Shape fields (if configured)
3. Redacted transcript → general AI eval + Deal Review AI
4. Deal Review JSON → Shape `deal_review_summary` field
5. Call Tracker shows structured Deal Review; transcript redacted except for transcript admins
