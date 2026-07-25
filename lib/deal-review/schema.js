export const DEAL_REVIEW_SCHEMA_VERSION = '1.0';

const STRING = { type: 'string' };
const STRING_ARRAY = { type: 'array', items: STRING };

const LTV_SCHEMA = {
  type: 'object',
  properties: {
    value: STRING,
    basis: STRING,
    label: STRING,
  },
  required: ['value', 'basis', 'label'],
  additionalProperties: false,
};

export const DEAL_REVIEW_OPENAI_SCHEMA = {
  type: 'object',
  properties: {
    confidence: {
      type: 'object',
      properties: {
        classification: { type: 'string', enum: ['high', 'medium', 'low'] },
        rationale: STRING,
      },
      required: ['classification', 'rationale'],
      additionalProperties: false,
    },
    classification: {
      type: 'object',
      properties: {
        recommended: {
          type: 'string',
          enum: [
            'standard',
            'non_qm',
            'construction',
            'investor_spec',
            'dscr',
            'reverse',
            'commercial',
            'complex',
            'a_team_review',
            'insufficient_info',
          ],
        },
        routing: {
          type: 'string',
          enum: ['lo_standard', 'senior_review', 'ops_review'],
        },
        human_review_required: { type: 'boolean' },
      },
      required: ['recommended', 'routing', 'human_review_required'],
      additionalProperties: false,
    },
    borrower_objective: STRING,
    loan_purpose: STRING,
    occupancy_intent: STRING,
    borrower_profile: {
      type: 'object',
      properties: {
        employment_type: STRING,
        w2_or_self_employed: STRING,
        time_in_job_or_business: STRING,
        stated_credit_range: STRING,
        stated_income: STRING,
        assets_reserves: STRING,
        existing_debts: STRING,
        current_housing_payment: STRING,
        coborrower_guarantor: STRING,
      },
      required: [
        'employment_type',
        'w2_or_self_employed',
        'time_in_job_or_business',
        'stated_credit_range',
        'stated_income',
        'assets_reserves',
        'existing_debts',
        'current_housing_payment',
        'coborrower_guarantor',
      ],
      additionalProperties: false,
    },
    transaction: {
      type: 'object',
      properties: {
        purpose_detail: STRING,
        property_type: STRING,
        property_state: STRING,
        purchase_price_or_value: STRING,
        requested_loan_amount: STRING,
        down_payment_or_equity: STRING,
        land_or_construction_budget: STRING,
        exit_strategy: STRING,
        desired_timing: STRING,
      },
      required: [
        'purpose_detail',
        'property_type',
        'property_state',
        'purchase_price_or_value',
        'requested_loan_amount',
        'down_payment_or_equity',
        'land_or_construction_budget',
        'exit_strategy',
        'desired_timing',
      ],
      additionalProperties: false,
    },
    preliminary_calculations: {
      type: 'object',
      properties: {
        ltv: LTV_SCHEMA,
        ltc: STRING,
        dti_indicator: STRING,
        liquidity: STRING,
      },
      required: ['ltv', 'ltc', 'dti_indicator', 'liquidity'],
      additionalProperties: false,
    },
    strengths: STRING_ARRAY,
    risks_and_contradictions: STRING_ARRAY,
    missing_information: STRING_ARRAY,
    required_documents: STRING_ARRAY,
    lender_direction: {
      type: 'object',
      properties: {
        likely_fits: STRING_ARRAY,
        possible_with_exception: STRING_ARRAY,
        clear_non_fits: STRING_ARRAY,
        additional_info_before_placement: STRING_ARRAY,
        note: STRING,
      },
      required: [
        'likely_fits',
        'possible_with_exception',
        'clear_non_fits',
        'additional_info_before_placement',
        'note',
      ],
      additionalProperties: false,
    },
    next_borrower_questions: STRING_ARRAY,
    recommended_follow_up: STRING,
    provenance: {
      type: 'object',
      properties: {
        borrower_stated: STRING_ARRAY,
        document_verified: STRING_ARRAY,
        system_calculated: STRING_ARRAY,
        missing_or_unresolved: STRING_ARRAY,
      },
      required: ['borrower_stated', 'document_verified', 'system_calculated', 'missing_or_unresolved'],
      additionalProperties: false,
    },
  },
  required: [
    'confidence',
    'classification',
    'borrower_objective',
    'loan_purpose',
    'occupancy_intent',
    'borrower_profile',
    'transaction',
    'preliminary_calculations',
    'strengths',
    'risks_and_contradictions',
    'missing_information',
    'required_documents',
    'lender_direction',
    'next_borrower_questions',
    'recommended_follow_up',
    'provenance',
  ],
  additionalProperties: false,
};

export function normalizeDealReview(parsed) {
  return {
    schema_version: DEAL_REVIEW_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    confidence: {
      classification: parsed.confidence?.classification ?? 'low',
      rationale: String(parsed.confidence?.rationale ?? '').trim(),
    },
    classification: {
      recommended: parsed.classification?.recommended ?? 'insufficient_info',
      routing: parsed.classification?.routing ?? 'lo_standard',
      human_review_required: Boolean(parsed.classification?.human_review_required),
    },
    borrower_objective: String(parsed.borrower_objective ?? '').trim(),
    loan_purpose: String(parsed.loan_purpose ?? '').trim(),
    occupancy_intent: String(parsed.occupancy_intent ?? '').trim(),
    borrower_profile: { ...parsed.borrower_profile },
    transaction: { ...parsed.transaction },
    preliminary_calculations: {
      ltv: {
        value: String(parsed.preliminary_calculations?.ltv?.value ?? '').trim(),
        basis: String(parsed.preliminary_calculations?.ltv?.basis ?? 'borrower_stated').trim(),
        label: String(parsed.preliminary_calculations?.ltv?.label ?? 'Preliminary — unverified').trim(),
      },
      ltc: String(parsed.preliminary_calculations?.ltc ?? '').trim(),
      dti_indicator: String(parsed.preliminary_calculations?.dti_indicator ?? '').trim(),
      liquidity: String(parsed.preliminary_calculations?.liquidity ?? '').trim(),
    },
    strengths: (parsed.strengths ?? []).map((s) => String(s).trim()).filter(Boolean),
    risks_and_contradictions: (parsed.risks_and_contradictions ?? []).map((s) => String(s).trim()).filter(Boolean),
    missing_information: (parsed.missing_information ?? []).map((s) => String(s).trim()).filter(Boolean),
    required_documents: (parsed.required_documents ?? []).map((s) => String(s).trim()).filter(Boolean),
    lender_direction: { ...parsed.lender_direction },
    next_borrower_questions: (parsed.next_borrower_questions ?? []).map((s) => String(s).trim()).filter(Boolean),
    recommended_follow_up: String(parsed.recommended_follow_up ?? '').trim(),
    provenance: {
      borrower_stated: (parsed.provenance?.borrower_stated ?? []).map(String),
      document_verified: (parsed.provenance?.document_verified ?? []).map(String),
      system_calculated: (parsed.provenance?.system_calculated ?? []).map(String),
      missing_or_unresolved: (parsed.provenance?.missing_or_unresolved ?? []).map(String),
    },
  };
}

export function validateDealReview(dealReview) {
  if (!dealReview || dealReview.schema_version !== DEAL_REVIEW_SCHEMA_VERSION) {
    return { valid: false, reason: 'Invalid or missing schema_version' };
  }
  if (!dealReview.classification?.recommended) {
    return { valid: false, reason: 'Missing classification.recommended' };
  }
  return { valid: true };
}

export function formatClassificationLabel(recommended) {
  const labels = {
    standard: 'Standard',
    non_qm: 'Non-QM',
    construction: 'Construction',
    investor_spec: 'Investor / Spec',
    dscr: 'DSCR',
    reverse: 'Reverse',
    commercial: 'Commercial',
    complex: 'Complex',
    a_team_review: 'A-Team Review',
    insufficient_info: 'Insufficient Info',
  };
  return labels[recommended] ?? recommended;
}
