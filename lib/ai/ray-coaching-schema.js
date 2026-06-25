/** JSON schema fragment for ray_coaching object (OpenAI strict mode). */

const RAY_COACHING_PROPERTIES = {
  one_line_verdict: { type: 'string' },
  call_phase: { type: 'string' },
  ray_outcome_code: { type: 'string' },
  field_scorecard: { type: 'string' },
  first_call_score: { type: 'string' },
  kpi_score: { type: 'string' },
  done_well: { type: 'string' },
  fix_now: { type: 'string' },
  say_this_next: { type: 'string' },
  ray_script: { type: 'string' },
  missed_on_call: { type: 'string' },
  program_fit: { type: 'string' },
  turndown_salvage: { type: 'string' },
  non_negotiable_flags: { type: 'string' },
  conversion_move: { type: 'string' },
};

export const RAY_COACHING_SCHEMA = {
  type: 'object',
  properties: RAY_COACHING_PROPERTIES,
  required: Object.keys(RAY_COACHING_PROPERTIES),
  additionalProperties: false,
};
