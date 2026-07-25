import { formatClassificationLabel } from './schema.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function listItems(items) {
  const rows = (items ?? []).filter((s) => String(s).trim());
  if (!rows.length) {
    return '<p><em>None noted</em></p>';
  }
  return `<ul>${rows.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function section(title, body) {
  if (!String(body ?? '').trim()) {
    return '';
  }
  return `<h3 style="margin:16px 0 6px;font-size:13px;text-transform:uppercase;color:#374151;">${escapeHtml(title)}</h3>${body}`;
}

/**
 * Formats deal_review v1 JSON as HTML for Shape rich-text custom field.
 */
export function buildDealReviewShapeHtml(dealReview) {
  if (!dealReview) {
    return '';
  }

  const cls = dealReview.classification ?? {};
  const conf = dealReview.confidence ?? {};
  const profile = dealReview.borrower_profile ?? {};
  const txn = dealReview.transaction ?? {};
  const calc = dealReview.preliminary_calculations ?? {};
  const lender = dealReview.lender_direction ?? {};

  const header = `<p style="margin:0 0 8px;font-size:11px;color:#6b7280;">Deal Review v${escapeHtml(dealReview.schema_version)} · ${escapeHtml(dealReview.generated_at ?? '')}</p>`;

  const classificationBlock = `<p><strong>Classification:</strong> ${escapeHtml(formatClassificationLabel(cls.recommended))} · <strong>Routing:</strong> ${escapeHtml(cls.routing ?? '')}${cls.human_review_required ? ' · <span style="color:#b45309;">Human review required</span>' : ''}</p><p style="color:#6b7280;font-size:12px;">Confidence: ${escapeHtml(conf.classification ?? '')} — ${escapeHtml(conf.rationale ?? '')}</p>`;

  const overview = `<p><strong>Objective:</strong> ${escapeHtml(dealReview.borrower_objective)}</p>
<p><strong>Loan purpose:</strong> ${escapeHtml(dealReview.loan_purpose)} · <strong>Occupancy:</strong> ${escapeHtml(dealReview.occupancy_intent)}</p>`;

  const profileBlock = `<p>Employment: ${escapeHtml(profile.employment_type)} (${escapeHtml(profile.w2_or_self_employed)}) · ${escapeHtml(profile.time_in_job_or_business)}</p>
<p>Credit: ${escapeHtml(profile.stated_credit_range)} · Income: ${escapeHtml(profile.stated_income)}</p>
<p>Assets/reserves: ${escapeHtml(profile.assets_reserves)} · Debts: ${escapeHtml(profile.existing_debts)}</p>
<p>Housing payment: ${escapeHtml(profile.current_housing_payment)} · Co-borrower: ${escapeHtml(profile.coborrower_guarantor)}</p>`;

  const txnBlock = `<p>${escapeHtml(txn.purpose_detail)}</p>
<p><strong>Property:</strong> ${escapeHtml(txn.property_type)} · ${escapeHtml(txn.property_state)} · Value/price: ${escapeHtml(txn.purchase_price_or_value)}</p>
<p><strong>Loan amount:</strong> ${escapeHtml(txn.requested_loan_amount)} · Down/equity: ${escapeHtml(txn.down_payment_or_equity)}</p>
<p>Construction/land: ${escapeHtml(txn.land_or_construction_budget)} · Exit: ${escapeHtml(txn.exit_strategy)} · Timing: ${escapeHtml(txn.desired_timing)}</p>`;

  const calcBlock = `<p><strong>LTV:</strong> ${escapeHtml(calc.ltv?.value)} <em>(${escapeHtml(calc.ltv?.label ?? 'Preliminary — unverified')})</em></p>
<p><strong>LTC:</strong> ${escapeHtml(calc.ltc)} · <strong>DTI indicator:</strong> ${escapeHtml(calc.dti_indicator)} · <strong>Liquidity:</strong> ${escapeHtml(calc.liquidity)}</p>`;

  const lenderBlock = `${listItems(lender.likely_fits?.map((f) => `Likely fit: ${f}`))}
${listItems(lender.possible_with_exception?.map((f) => `Possible w/ exception: ${f}`))}
${listItems(lender.clear_non_fits?.map((f) => `Clear non-fit: ${f}`))}
<p style="font-size:12px;color:#6b7280;"><em>${escapeHtml(lender.note ?? '')}</em></p>`;

  const followUp = `<p>${escapeHtml(dealReview.recommended_follow_up)}</p>${listItems(dealReview.next_borrower_questions)}`;

  return `<div style="font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#111827;">
${header}
${classificationBlock}
${section('Overview', overview)}
${section('Borrower profile', profileBlock)}
${section('Transaction', txnBlock)}
${section('Preliminary calculations', calcBlock)}
${section('Strengths', listItems(dealReview.strengths))}
${section('Risks & contradictions', listItems(dealReview.risks_and_contradictions))}
${section('Missing information', listItems(dealReview.missing_information))}
${section('Required documents', listItems(dealReview.required_documents))}
${section('Lender direction', lenderBlock)}
${section('Follow-up', followUp)}
</div>`;
}

export function buildDealReviewShapePayload(dealReview) {
  const html = buildDealReviewShapeHtml(dealReview);
  return { html };
}
