import { DEFAULT_MAILER_CALL_SCRIPT } from './default-call-script.js';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function getActiveMailerCampaign(supabase) {
  const { data, error } = await supabase
    .from('mailer_campaigns')
    .select('*')
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error && error.code !== '42P01') {
    throw error;
  }

  if (data) {
    return data;
  }

  return {
    week_label: process.env.MAILER_CURRENT_WEEK_LABEL || 'This week\'s mail',
    mail_drop_date: null,
    pdf_url: process.env.MAILER_CURRENT_WEEK_PDF_URL || '',
    script_markdown: process.env.MAILER_DEFAULT_SCRIPT_MARKDOWN || DEFAULT_MAILER_CALL_SCRIPT,
    is_active: true,
    source: 'env',
  };
}
