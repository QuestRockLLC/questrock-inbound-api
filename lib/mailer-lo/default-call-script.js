import { QUESTROCK_FIRST_CALL_FLOW_SCRIPT } from './first-call-flow-script.js';

export const DEFAULT_MAILER_CALL_SCRIPT = QUESTROCK_FIRST_CALL_FLOW_SCRIPT;

export function renderCallScript(template, context) {
  let text = template;
  for (const [key, value] of Object.entries(context)) {
    text = text.replaceAll(`{{${key}}}`, value ?? '—');
  }
  return text;
}
