/**
 * Env-driven Shape field keys for Deal Review + private identity (SSN/DOB).
 * Confirm exact API keys with Shape admin before production write.
 */

const DEFAULT_PRIVATE_SSN_FIELD = 'borSSN';
const DEFAULT_PRIVATE_DOB_FIELD = 'birthDate';
const DEFAULT_DEAL_REVIEW_FIELD = 'deal_review_summary';
const DEFAULT_SENIOR_REVIEW_FIELD = 'deal_review_senior_flag';

export function getShapePrivateSsnField() {
  return process.env.SHAPE_PRIVATE_SSN_FIELD?.trim() || DEFAULT_PRIVATE_SSN_FIELD;
}

export function getShapePrivateDobField() {
  return process.env.SHAPE_PRIVATE_DOB_FIELD?.trim() || DEFAULT_PRIVATE_DOB_FIELD;
}

export function getShapeDealReviewField() {
  return process.env.SHAPE_DEAL_REVIEW_FIELD?.trim() || DEFAULT_DEAL_REVIEW_FIELD;
}

export function getShapeSeniorReviewField() {
  return process.env.SHAPE_DEAL_REVIEW_SENIOR_FIELD?.trim() || DEFAULT_SENIOR_REVIEW_FIELD;
}

/** Whether private-field writes are allowed (requires field name + sync enabled). */
export function isPrivateIdentitySyncEnabled() {
  if (process.env.SHAPE_PRIVATE_IDENTITY_SYNC_ENABLED === 'false') {
    return false;
  }
  return Boolean(getShapePrivateSsnField() || getShapePrivateDobField());
}

export function isDealReviewShapeSyncEnabled() {
  if (process.env.SHAPE_DEAL_REVIEW_SYNC_ENABLED === 'false') {
    return false;
  }
  return Boolean(getShapeDealReviewField());
}

export function getDealReviewConfigSummary() {
  return {
    private_ssn_field: getShapePrivateSsnField(),
    private_dob_field: getShapePrivateDobField(),
    deal_review_field: getShapeDealReviewField(),
    senior_review_field: getShapeSeniorReviewField(),
    private_identity_sync_enabled: isPrivateIdentitySyncEnabled(),
    deal_review_sync_enabled: isDealReviewShapeSyncEnabled(),
  };
}
