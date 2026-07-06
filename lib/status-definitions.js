const DEFAULT_STATUS_LABEL = 'Not Contacted';

/** Shape CRM picklist labels allowed for AI classification + mstrstatus1 sync. */
export const SHAPE_AI_STATUS_LABELS = [
  'Advanced',
  'Not Contacted',
  'Did Not Advance',
  'Bad Lead',
  'Turndown',
];

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function loadStatusDefinitions(supabase) {
  const { data, error } = await supabase
    .from('status_definitions')
    .select('status_label, color, description, priority')
    .order('priority', { ascending: true });

  if (error) {
    throw error;
  }

  return data ?? [];
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function getStatusByLabel(supabase, statusLabel) {
  const { data, error } = await supabase
    .from('status_definitions')
    .select('status_label, color, description, priority')
    .eq('status_label', statusLabel)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function getDefaultStatus(supabase) {
  const status =
    (await getStatusByLabel(supabase, DEFAULT_STATUS_LABEL)) ??
    (await loadStatusDefinitions(supabase))[0];

  if (!status) {
    const error = new Error('No rows found in status_definitions.');
    error.statusCode = 500;
    throw error;
  }

  return status;
}

export { DEFAULT_STATUS_LABEL };
