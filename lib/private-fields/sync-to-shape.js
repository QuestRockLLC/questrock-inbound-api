import { updateShapeLeadFields, isShapeTranscriptSyncEnabled } from '../shape/client.js';
import {
  getShapePrivateDobField,
  getShapePrivateSsnField,
  getShapeSeniorReviewField,
  getShapeDealReviewField,
  isPrivateIdentitySyncEnabled,
  isDealReviewShapeSyncEnabled,
} from '../shape/deal-review-config.js';
import { buildDealReviewShapeHtml } from '../deal-review/build-shape-payload.js';

/**
 * Writes SSN/DOB to private Shape fields only — never merged into general AI eval.
 */
export async function syncPrivateIdentityFields(shapeLeadId, extractResult) {
  if (!isShapeTranscriptSyncEnabled() || !isPrivateIdentitySyncEnabled()) {
    return {
      synced: false,
      skipped: true,
      reason: 'Private identity sync disabled or transcript sync off',
    };
  }

  const { shapeWrite, audit } = extractResult ?? {};
  const fields = {};

  if (shapeWrite?.ssn) {
    const key = getShapePrivateSsnField();
    if (key) fields[key] = shapeWrite.ssn;
  }
  if (shapeWrite?.dob) {
    const key = getShapePrivateDobField();
    if (key) fields[key] = shapeWrite.dob;
  }

  if (!Object.keys(fields).length) {
    return {
      synced: false,
      skipped: true,
      reason: 'No verified SSN/DOB to write',
      audit,
    };
  }

  const result = await updateShapeLeadFields(shapeLeadId, fields);
  return {
    ...result,
    audit,
    fields_sent: Object.keys(fields),
  };
}

/**
 * Writes formatted Deal Review HTML to Shape custom field.
 */
export async function syncDealReviewToShape(shapeLeadId, dealReview) {
  if (!isShapeTranscriptSyncEnabled() || !isDealReviewShapeSyncEnabled()) {
    return {
      synced: false,
      skipped: true,
      reason: 'Deal Review Shape sync disabled or transcript sync off',
    };
  }

  if (!dealReview) {
    return { synced: false, skipped: true, reason: 'No deal review payload' };
  }

  const fieldKey = getShapeDealReviewField();
  if (!fieldKey) {
    return { synced: false, skipped: true, reason: 'SHAPE_DEAL_REVIEW_FIELD not configured' };
  }

  const html = buildDealReviewShapeHtml(dealReview);
  const fields = { [fieldKey]: html };

  const cls = dealReview.classification ?? {};
  if (cls.human_review_required || cls.routing === 'senior_review' || cls.recommended === 'a_team_review') {
    const seniorField = getShapeSeniorReviewField();
    if (seniorField) {
      fields[seniorField] = 'Yes — Deal Review flagged for senior review';
    }
  }

  const result = await updateShapeLeadFields(shapeLeadId, fields);
  return {
    ...result,
    fields_sent: Object.keys(fields),
  };
}
