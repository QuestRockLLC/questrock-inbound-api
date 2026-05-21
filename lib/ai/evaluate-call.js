import { EXTRACTABLE_FIELDS } from './field-catalog.js';
import { mergeFieldsForShapeUpdate } from './normalize-fields.js';
import {
  buildEvaluationSystemPrompt,
  buildEvaluationUserPrompt,
} from './prompts.js';

const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'questrock_call_evaluation',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        status_label: { type: 'string' },
        status_rationale: { type: 'string' },
        call_summary: { type: 'string' },
        lead_fields: {
          type: 'object',
          properties: {
            full_name: { type: 'string' },
            email: { type: 'string' },
            current_address: { type: 'string' },
            city: { type: 'string' },
            state: { type: 'string' },
            zip_code: { type: 'string' },
            company_name: { type: 'string' },
          },
          required: [
            'full_name',
            'email',
            'current_address',
            'city',
            'state',
            'zip_code',
            'company_name',
          ],
          additionalProperties: false,
        },
        extracted_fields: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              value: { type: 'string' },
              confidence: { type: 'number' },
              overwrite: { type: 'boolean' },
            },
            required: ['field', 'value', 'confidence', 'overwrite'],
            additionalProperties: false,
          },
        },
      },
      required: ['status_label', 'status_rationale', 'call_summary', 'lead_fields', 'extracted_fields'],
      additionalProperties: false,
    },
  },
};

function truncate(text, max) {
  const value = String(text ?? '');
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, max)}\n\n...[truncated]`;
}

function mapLeadFieldsToTable(leadFields = {}) {
  return {
    full_name: leadFields.full_name || null,
    email: leadFields.email || null,
    current_address: leadFields.current_address || null,
    city: leadFields.city || null,
    state: leadFields.state || null,
    zip_code: leadFields.zip_code || null,
    company_name: leadFields.company_name || null,
  };
}

function buildTranscriptHistoryText(transcriptHistory) {
  return transcriptHistory
    .map((row, index) => {
      const text = row.transcript_text?.trim();
      if (!text) {
        return `[${index + 1}] (${row.call_source ?? 'unknown'} @ ${row.timestamp ?? 'unknown'} — call event, no text)`;
      }

      return `[${index + 1}] (${row.call_source ?? 'unknown'} @ ${row.timestamp})\n${text}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Reads full transcript history, classifies status, and extracts Shape CRM fields.
 */
export async function evaluateCallWithAi({
  lead,
  shapeLead = {},
  transcriptHistory,
  latestTranscriptText,
  statusDefinitions,
}) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    const error = new Error('Missing OPENAI_API_KEY environment variable.');
    error.statusCode = 500;
    throw error;
  }

  const allowedStatuses = new Set(statusDefinitions.map((row) => row.status_label));
  const allowedFieldSet = new Set(EXTRACTABLE_FIELDS);
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const system = buildEvaluationSystemPrompt();
  const user = buildEvaluationUserPrompt({
    statusDefinitions,
    lead,
    shapeLead,
    transcriptHistoryText: truncate(buildTranscriptHistoryText(transcriptHistory), 30_000),
    latestTranscriptText: truncate(latestTranscriptText, 12_000),
  });

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.12,
      max_completion_tokens: 10_000,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: RESPONSE_FORMAT,
    }),
  });

  const rawText = await response.text();
  let data;

  try {
    data = JSON.parse(rawText);
  } catch {
    const error = new Error('OpenAI returned non-JSON.');
    error.statusCode = 502;
    throw error;
  }

  if (!response.ok) {
    const message = data?.error?.message || rawText.slice(0, 400);
    const error = new Error(`OpenAI: ${message}`);
    error.statusCode = 502;
    throw error;
  }

  const content = data?.choices?.[0]?.message?.content;

  if (!content) {
    const error = new Error('OpenAI returned an empty completion.');
    error.statusCode = 502;
    throw error;
  }

  const parsed = JSON.parse(content);

  if (!allowedStatuses.has(parsed.status_label)) {
    const error = new Error(
      `AI returned invalid status_label "${parsed.status_label}". Must match status_definitions exactly.`,
    );
    error.statusCode = 422;
    throw error;
  }

  const status = statusDefinitions.find((row) => row.status_label === parsed.status_label);
  const extractedRows = (parsed.extracted_fields ?? []).filter((row) =>
    allowedFieldSet.has(String(row.field ?? '').trim()),
  );

  const fieldsPopulated = mergeFieldsForShapeUpdate({
    extractedFields: extractedRows,
    existingShapeLead: shapeLead,
    minConfidence: Number(process.env.AI_MIN_FIELD_CONFIDENCE ?? 0.55),
  });

  return {
    status,
    statusRationale: parsed.status_rationale,
    callSummary: parsed.call_summary,
    leadFields: mapLeadFieldsToTable(parsed.lead_fields),
    fieldsPopulated,
    extractedRows,
  };
}

export { EXTRACTABLE_FIELDS };
