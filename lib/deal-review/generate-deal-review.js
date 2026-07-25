import {
  buildDealReviewSystemPrompt,
  buildDealReviewUserPrompt,
} from './build-prompt.js';
import { DEAL_REVIEW_OPENAI_SCHEMA, normalizeDealReview } from './schema.js';
import { redactTranscriptPii } from '../transcript-redact.js';

const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'questrock_deal_review',
    strict: true,
    schema: DEAL_REVIEW_OPENAI_SCHEMA,
  },
};

/**
 * Generates structured deal_review v1 from redacted transcript (isolated AI task).
 */
export async function generateDealReviewWithAi({
  lead = {},
  shapeLead = {},
  transcriptText,
  callSummary,
  aiStatusLabel,
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ok: false, skipped: true, reason: 'Missing OPENAI_API_KEY' };
  }

  const redacted = redactTranscriptPii(String(transcriptText ?? '').trim());
  if (redacted.length < 40) {
    return { ok: false, skipped: true, reason: 'Transcript too short for Deal Review' };
  }

  const model = process.env.OPENAI_DEAL_REVIEW_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.05,
      max_completion_tokens: 8000,
      messages: [
        { role: 'system', content: buildDealReviewSystemPrompt() },
        {
          role: 'user',
          content: buildDealReviewUserPrompt({
            lead,
            shapeLead,
            transcriptText: redacted,
            callSummary,
            aiStatusLabel,
          }),
        },
      ],
      response_format: RESPONSE_FORMAT,
    }),
  });

  const rawText = await response.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    return { ok: false, error: 'OpenAI returned non-JSON for Deal Review' };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: data?.error?.message || rawText.slice(0, 400),
    };
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    return { ok: false, error: 'Empty Deal Review completion' };
  }

  try {
    const parsed = JSON.parse(content);
    const dealReview = normalizeDealReview(parsed);
    return { ok: true, dealReview };
  } catch {
    return { ok: false, error: 'Failed to parse Deal Review JSON' };
  }
}
