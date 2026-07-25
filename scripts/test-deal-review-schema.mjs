import assert from 'node:assert/strict';
import { normalizeDealReview, validateDealReview, formatClassificationLabel } from '../lib/deal-review/schema.js';
import { buildDealReviewShapeHtml } from '../lib/deal-review/build-shape-payload.js';

const minimal = normalizeDealReview({
  confidence: { classification: 'high', rationale: 'Clear purpose stated' },
  classification: {
    recommended: 'standard',
    routing: 'lo_standard',
    human_review_required: false,
  },
  borrower_objective: 'Refinance primary residence',
  loan_purpose: 'Rate and term refi',
  occupancy_intent: 'Primary',
  borrower_profile: {
    employment_type: 'W-2',
    w2_or_self_employed: 'W-2',
    time_in_job_or_business: '5 years',
    stated_credit_range: '720+',
    stated_income: '$95k',
    assets_reserves: '2 months',
    existing_debts: 'Car payment',
    current_housing_payment: '$1800',
    coborrower_guarantor: 'None',
  },
  transaction: {
    purpose_detail: 'Lower rate',
    property_type: 'SFR',
    property_state: 'FL',
    purchase_price_or_value: '$400k',
    requested_loan_amount: '$320k',
    down_payment_or_equity: '$80k equity',
    land_or_construction_budget: 'N/A',
    exit_strategy: 'N/A',
    desired_timing: '30 days',
  },
  preliminary_calculations: {
    ltv: { value: '80%', basis: 'borrower_stated', label: 'Preliminary — unverified' },
    ltc: 'N/A',
    dti_indicator: 'Moderate',
    liquidity: 'Adequate',
  },
  strengths: ['Strong credit'],
  risks_and_contradictions: [],
  missing_information: ['Exact income docs'],
  required_documents: ['Pay stubs'],
  lender_direction: {
    likely_fits: ['Agency'],
    possible_with_exception: [],
    clear_non_fits: [],
    additional_info_before_placement: [],
    note: 'Recommendation only',
  },
  next_borrower_questions: ['HOA dues?'],
  recommended_follow_up: 'Send doc list',
  provenance: {
    borrower_stated: ['transaction.requested_loan_amount'],
    document_verified: [],
    system_calculated: ['preliminary_calculations.ltv'],
    missing_or_unresolved: [],
  },
});

assert.equal(validateDealReview(minimal).valid, true);
assert.equal(minimal.schema_version, '1.0');
assert.equal(formatClassificationLabel('non_qm'), 'Non-QM');

const html = buildDealReviewShapeHtml(minimal);
assert.ok(html.includes('Deal Review'));
assert.ok(!html.includes('[SSN REDACTED]'));

console.log('deal-review-schema: ok');
