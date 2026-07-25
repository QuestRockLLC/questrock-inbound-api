# Shape field mapping — Deal Review & private identity

> **Status:** Proposed defaults until confirmed with Arsalan / Shape admin. Override via env vars in `.env`.

## Private identity (SSN + DOB)

| Purpose | Env var | Proposed Shape key | Notes |
|---------|---------|-------------------|-------|
| Borrower SSN | `SHAPE_PRIVATE_SSN_FIELD` | `borSSN` | Restricted/private field; never logged or shown in Call Tracker |
| Borrower DOB | `SHAPE_PRIVATE_DOB_FIELD` | `birthDate` | QR Dashboard bulk export uses "Birth Date"; verify write permission |
| Enable/disable private sync | `SHAPE_PRIVATE_IDENTITY_SYNC_ENABLED` | — | Default `true` when field names are set |

**Write path:** `updateShapeLeadFields()` only — isolated from `syncShapeLeadFromEvaluation()`.

**Verification states** (stored in Supabase `fields_populated.private_identity`, not raw values):

- `verified` — full 9-digit SSN or high-confidence DOB
- `needs_verification` — last-four SSN or ambiguous DOB
- `not_found` — nothing extractable

## Deal Review (structured narrative → Shape)

| Purpose | Env var | Proposed Shape key | Notes |
|---------|---------|-------------------|-------|
| Full Deal Review HTML | `SHAPE_DEAL_REVIEW_FIELD` | `deal_review_summary` | New custom rich-text field (Option A) |
| Senior / A-team flag | `SHAPE_DEAL_REVIEW_SENIOR_FIELD` | `deal_review_senior_flag` | Optional checkbox or text flag |
| Enable/disable DR sync | `SHAPE_DEAL_REVIEW_SYNC_ENABLED` | — | Default `true` when field name is set |

**Write path:** `syncDealReviewToShape()` — formatted HTML from `deal_review` v1 JSON; no transcript quotes.

## Call Tracker access

| Role | Emails (default) | Transcript |
|------|------------------|------------|
| Full access | `arashid@questrock.com` (Arsalan) | Original transcript — SSN/DOB visible |
| Compliance view | Nikk, Ray, Jason, Bill | Redacted transcript — no SSN/DOB |
| No access | Everyone else | — |

Env vars:

| Purpose | Env var | Default |
|---------|---------|---------|
| Who can open Call Tracker | `CALL_TRACKER_EMAILS` | Arsalan, Nikk, Bill, Ray, Jason |
| Unredacted transcript | `TRANSCRIPT_ADMIN_EMAILS` | `arashid@questrock.com` only |

## Existing fields (unchanged)

- `mstrstatus1` — AI call status (via `syncShapeLeadFromEvaluation`)
- CRM extract fields — `field-catalog.js` keys only
- `notes_sidebar` — short LO goals (2–4 sentences), never full transcript
- `notes_sidebar_ai_note` — ops notes only

## Confirmation checklist (ops)

- [ ] Exact Shape API key for private SSN field
- [ ] Exact Shape API key for DOB (`birthDate` vs "Birth Date" label)
- [ ] Custom field created for `deal_review_summary`
- [ ] Senior review alert mechanism (field, status, or Zapier)
- [ ] Arsalan email on `TRANSCRIPT_ADMIN_EMAILS`
