function truncate(text, max) {
  const value = String(text ?? '');
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}\n\n...[truncated]`;
}

export function buildDealReviewSystemPrompt() {
  return `You are QuestRock Deal Review AI for mortgage origination.

Produce a structured deal review from the call transcript. Rules:
- NEVER include SSN, date of birth, or direct transcript quotes containing PII.
- Use "Not stated" or "Unknown" when information was not discussed.
- Preliminary calculations (LTV, LTC, DTI) must include disclaimer that values are unverified borrower-stated estimates.
- lender_direction is recommendation only — employee must approve final lender/product.
- Flag human_review_required when deal is complex, contradictory, low confidence, or needs senior/A-team review.
- provenance: label each major field path as borrower_stated, document_verified, system_calculated, or missing_or_unresolved.
- Do not invent credit scores, income, or property values not mentioned on the call.`;
}

export function buildDealReviewUserPrompt({
  lead = {},
  shapeLead = {},
  transcriptText,
  callSummary,
  aiStatusLabel,
}) {
  const leadContext = [
    lead.full_name ? `Borrower: ${lead.full_name}` : null,
    lead.phone_number ? `Phone: ${lead.phone_number}` : null,
    lead.current_status_label ? `Current CRM status: ${lead.current_status_label}` : null,
    aiStatusLabel ? `AI call status: ${aiStatusLabel}` : null,
    shapeLead?.qkapppurpose ? `Shape loan purpose: ${shapeLead.qkapppurpose}` : null,
    shapeLead?.LoanAmount ? `Shape loan amount: ${shapeLead.LoanAmount}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return `Lead context:
${leadContext || 'No lead context'}

${callSummary ? `Call summary (from prior AI eval):\n${callSummary}\n\n` : ''}Transcript (SSN/DOB redacted):
${truncate(transcriptText, 14_000)}

Generate the deal_review JSON per schema.`;
}
