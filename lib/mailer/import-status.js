import { getStatusByLabel } from '../status-definitions.js';

/** Default Supabase + Shape status for new QuestMail / mailer CSV imports. */
export const MAILER_IMPORT_STATUS_LABEL =
  process.env.MAILER_IMPORT_STATUS?.trim() ||
  process.env.SHAPE_MAILER_DEFAULT_STATUS?.trim() ||
  'Dormant';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function getMailerImportStatus(supabase) {
  return (
    (await getStatusByLabel(supabase, MAILER_IMPORT_STATUS_LABEL)) ??
    (await getStatusByLabel(supabase, 'Not Contacted')) ??
    (await getStatusByLabel(supabase, 'Did Not Advance'))
  );
}
