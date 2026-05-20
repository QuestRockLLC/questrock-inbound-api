/**
 * Lead-table + Shape-oriented fields AI may populate from transcripts.
 */
export const EXTRACTABLE_FIELDS = [
  'firstname',
  'lastname',
  'phone',
  'email',
  'boraddress',
  'borcity',
  'borstate',
  'borzip',
  'prStreetAddress',
  'prCity',
  'prState',
  'prZip',
  'prCounty',
  'qkapppropertyType',
  'qkappnumberOfunits',
  'qkappestAppraisalVal',
  'propropertyUse',
  'qkapppurpose',
  'LoanAmount',
  'borcreditscore',
  'notes_sidebar',
  'boremployer',
  'borempinfoEmpPosition',
  'borempinfoEmpType',
];

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
            },
            required: ['field', 'value'],
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

function buildStatusPrompt(statusDefinitions) {
  return statusDefinitions
    .map(
      (row) =>
        `- ${row.status_label} (${row.color ?? 'unknown color'}) — ${row.description ?? ''}`,
    )
    .join('\n');
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

/**
 * Reads full transcript history and assigns status + field updates.
 */
export async function evaluateCallWithAi({
  lead,
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
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const combinedHistory = transcriptHistory
    .map((row, index) => {
      const text = row.transcript_text?.trim();
      if (!text) {
        return `[${index + 1}] (${row.call_source ?? 'unknown'} — call event, no text)`;
      }

      return `[${index + 1}] (${row.call_source ?? 'unknown'} @ ${row.timestamp})\n${text}`;
    })
    .join('\n\n---\n\n');

  const system = `You are QuestRock Home Loans' AI call reviewer.

Given a lead record, prior transcript history, and the newest transcript, you must:
1) Choose exactly ONE status_label from the allowed list below.
2) Explain why in status_rationale (1-3 sentences).
3) Write call_summary for admins (2-4 sentences, plain English).
4) Propose lead_fields ONLY when supported by transcript evidence (empty string if unknown).
5) Populate extracted_fields using allowed Shape keys when transcript supports them.

Rules:
- status_label MUST match an allowed label exactly (case and punctuation).
- Prefer conservative statuses when evidence is weak (e.g. Not Contacted, Long Term Nurture).
- Green moving-forward statuses require clear appointment/advance signals.
- Red statuses require explicit turndown, denial, missed appointment, or bad lead signals.
- Do not invent SSN, account numbers, or contact info not stated on the call.
- Use empty strings in lead_fields when not mentioned.
- extracted_fields[].field must come from the allowed field list in the user message.`;

  const user = `Allowed statuses:
${buildStatusPrompt(statusDefinitions)}

Allowed Shape field keys for extracted_fields:
${EXTRACTABLE_FIELDS.join(', ')}

Current lead:
${truncate(JSON.stringify(lead, null, 2), 12_000)}

Transcript history:
${truncate(combinedHistory, 48_000)}

Newest transcript to evaluate:
${truncate(latestTranscriptText, 24_000)}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.15,
      max_completion_tokens: 8_000,
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
      `AI returned invalid status_label "${parsed.status_label}". Must be one of the seeded status_definitions rows.`,
    );
    error.statusCode = 422;
    throw error;
  }

  const status = statusDefinitions.find((row) => row.status_label === parsed.status_label);

  const allowedFieldSet = new Set(EXTRACTABLE_FIELDS);
  const fieldsPopulated = {};

  for (const row of parsed.extracted_fields ?? []) {
    const field = String(row.field ?? '').trim();
    const value = String(row.value ?? '').trim();

    if (!field || !value || !allowedFieldSet.has(field)) {
      continue;
    }

    fieldsPopulated[field] = value;
  }

  return {
    status,
    statusRationale: parsed.status_rationale,
    callSummary: parsed.call_summary,
    leadFields: mapLeadFieldsToTable(parsed.lead_fields),
    fieldsPopulated,
  };
}
