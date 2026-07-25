import { extractSsnDob, summarizePrivateIdentity } from '../private-fields/extract-ssn-dob.js';
import {
  syncDealReviewToShape,
  syncPrivateIdentityFields,
} from '../private-fields/sync-to-shape.js';
import { generateDealReviewWithAi } from './generate-deal-review.js';
import { summarizeShapeSync } from '../transcript-ai-review.js';

/**
 * Post-AI deal intelligence: private SSN/DOB extract → Shape, Deal Review AI → Shape.
 * Isolated from general evaluation merge.
 */
export async function runDealIntelligencePipeline({
  shapeLeadId,
  transcriptText,
  lead = {},
  shapeLead = {},
  evaluation = null,
}) {
  const privateExtract = extractSsnDob(transcriptText);
  const privateSync = await syncPrivateIdentityFields(shapeLeadId, privateExtract);

  const dealReviewResult = await generateDealReviewWithAi({
    lead,
    shapeLead,
    transcriptText,
    callSummary: evaluation?.callSummary,
    aiStatusLabel: evaluation?.status?.status_label,
  });

  let dealReviewSync = { skipped: true, reason: 'Deal Review not generated' };
  if (dealReviewResult.ok && dealReviewResult.dealReview) {
    dealReviewSync = await syncDealReviewToShape(shapeLeadId, dealReviewResult.dealReview);
  }

  return {
    private_identity: summarizePrivateIdentity(privateExtract),
    private_identity_sync: summarizeShapeSync(privateSync),
    deal_review: dealReviewResult.dealReview ?? null,
    deal_review_sync: summarizeShapeSync(dealReviewSync),
    deal_review_skipped: dealReviewResult.skipped ?? false,
    deal_review_error: dealReviewResult.error ?? dealReviewResult.reason ?? null,
  };
}
