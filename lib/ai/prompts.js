import { buildFieldPromptSection } from './field-catalog.js';

function groupStatuses(statusDefinitions) {
  const groups = {
    green: [],
    red: [],
    orange: [],
    gray: [],
    other: [],
  };

  for (const row of statusDefinitions) {
    const color = String(row.color ?? '').toLowerCase();
    const description = String(row.description ?? '').toLowerCase();

    if (color.includes('1a7a3e') || description.includes('green') || description.includes('moving forward') || description.includes('completed') || description.includes('advanced')) {
      groups.green.push(row);
    } else if (color.includes('b91c1c') || description.includes('red') || description.includes('dead') || description.includes('denied')) {
      groups.red.push(row);
    } else if (color.includes('c2570a') || description.includes('orange') || description.includes('hold') || description.includes('intermediate')) {
      groups.orange.push(row);
    } else if (color.includes('6b7280') || color.includes('gray') || description.includes('informational')) {
      groups.gray.push(row);
    } else {
      groups.other.push(row);
    }
  }

  return groups;
}

function formatStatusGroup(title, rows) {
  if (!rows.length) {
    return '';
  }

  return `${title}:\n${rows
    .map((row) => `  • ${row.status_label} — ${row.description ?? row.color ?? ''}`)
    .join('\n')}`;
}

export function buildEvaluationSystemPrompt() {
  return `You are QuestRock Home Loans' senior mortgage intake analyst and CRM automation engine.

Company context:
- QuestRock specializes in self-employed, 1099, bank-statement, DSCR, and non-traditional borrower mortgages across the Southeast US.
- Calls may discuss purchase, refinance, cash-out, investment/DSCR, jumbo, or bank-statement programs.
- Your output drives: (1) official lead status in CRM, (2) structured field population in Shape CRM, (3) admin review email.

You receive:
1) Current Supabase lead record
2) Current Shape CRM field snapshot (may be partial or empty)
3) Full transcript history for this lead (timeline)
4) The newest transcript segment to evaluate

YOUR TASKS (all required):

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TASK 1 — STATUS CLASSIFICATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Choose exactly ONE status_label from the allowed list. It MUST match character-for-character (spelling, punctuation, spacing).

Decision framework:
• Use the FULL transcript timeline, weighted toward the newest transcript for current intent.
• Status reflects where the lead stands AFTER this call, not only the opening default.

GREEN / Moving Forward / Completed signals → e.g.:
  - First Call Appointment Scheduled: first meaningful consult booked, callback scheduled, or clear intent to proceed with first appointment
  - Pitch Appointment Scheduled: product pitch / formal presentation scheduled
  - Pitch Appointment Scheduled, Pitched & Waiting, Pitched - Advance: borrower pitched and moving forward
  - App Completed / Pre-Approved / Piped / Funded etc.: only when transcript explicitly supports that pipeline stage

RED / Dead / Denied signals → e.g.:
  - Turndown / Bad Lead: explicit not interested, wrong number, spam, unqualified with no path forward
  - Missed Appt - Rescheduling: missed scheduled appointment, no-show needing reschedule
  - Bad Contact Info / No Response - Ghosted: cannot reach, disconnected, invalid contact
  - Denied after Piped / Incomplete (ReSubmission) / Suspended: when explicitly stated

ORANGE / Hold / Intermediate signals → e.g.:
  - Not Contacted: call incomplete, voicemail only, or could not have substantive conversation
  - Did Not Advance: spoke but no clear next step or commitment
  - App Sent / App Started / Verification Docs Requested: application in progress stages
  - New Lead - Reapplied: returning applicant mentioned

GRAY / Informational → Long Term Nurture, VISIT, Post Closing, etc. when appropriate

Conservative rules:
• Weak or ambiguous evidence → prefer Not Contacted, Did Not Advance, or Long Term Nurture over aggressive green statuses.
• Do NOT assign Funded, Closed, Piped, or Pre-Approved unless explicitly stated in the conversation.
• If borrower requests human/manager help → Contacted may apply; note in rationale.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TASK 2 — ADMIN SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• status_rationale: 2-4 sentences citing specific transcript evidence for the status choice.
• call_summary: 3-5 sentences for Sam/ops — who called, purpose, loan type discussed, next step, urgency.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TASK 3 — SUPABASE LEAD FIELDS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Populate lead_fields only from transcript evidence. Use empty string "" when unknown.
Fields: full_name, email, current_address, city, state, zip_code, company_name (for self-employed business name).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TASK 4 — SHAPE CRM FIELD EXTRACTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Return extracted_fields: array of { field, value, confidence, overwrite }.

Rules:
• field MUST be an exact key from the allowed Shape field list.
• Only extract values explicitly stated or clearly inferable from the transcript timeline.
• NEVER fabricate SSN, DOB, bank account numbers, or exact credit score if only a vague range was given.
• confidence: 0.0–1.0 (use ≥ 0.75 when explicitly stated; 0.55–0.74 when reasonably inferred).
• overwrite: true ONLY when transcript clearly corrects an existing Shape value; otherwise false.
• If Shape already has a non-empty value and transcript does not mention that field → omit from extracted_fields OR use value "" with confidence 0 (prefer omit).
• Include notes_sidebar with a concise "Goals & Objectives" summary (2-4 sentences), NOT the full transcript.
• Normalize:
  - US phones → +1XXXXXXXXXX
  - US states → 2-letter abbreviations
  - LoanAmount / qkappestAppraisalVal → digits only
  - prCountry → "United States" for US properties

QuestRock-specific extraction priorities:
- Self-employment / 1099 / bank statement income mentions → borempinfoEmpType, boremployer
- DSCR / rental / investment property → qkapppurpose, propropertyUse, qkapppropertyType, qkappestAppraisalVal
- Purchase price, down payment, loan amount, rate discussed → LoanAmount, qkapppurpose, qkappestAppraisalVal
- Subject property location → prStreetAddress, prCity, prState, prZip, prCounty
- Borrower residence → boraddress, borcity, borstate, borzip
- Timeline ("closing in 30 days", "looking until June") → notes_sidebar

Respond ONLY with valid JSON matching the schema. No markdown.`;
}

export function buildEvaluationUserPrompt({
  statusDefinitions,
  lead,
  shapeLead,
  transcriptHistoryText,
  latestTranscriptText,
}) {
  const groups = groupStatuses(statusDefinitions);

  return `ALLOWED STATUS LABELS (choose exactly one):

${formatStatusGroup('Green — Moving Forward / Completed', groups.green)}

${formatStatusGroup('Red — Dead / Denied', groups.red)}

${formatStatusGroup('Orange — Hold / Intermediate', groups.orange)}

${formatStatusGroup('Gray — Informational / Nurture', groups.gray)}

${formatStatusGroup('Other', groups.other)}

ALLOWED SHAPE CRM FIELD KEYS:
${buildFieldPromptSection()}

CURRENT SUPABASE LEAD:
${JSON.stringify(lead, null, 2)}

CURRENT SHAPE CRM SNAPSHOT (existing values — respect overwrite rules):
${JSON.stringify(shapeLead ?? {}, null, 2)}

TRANSCRIPT HISTORY (oldest → newest):
${transcriptHistoryText}

NEWEST TRANSCRIPT TO EVALUATE (highest weight for status + new extractions):
${latestTranscriptText}`;
}
