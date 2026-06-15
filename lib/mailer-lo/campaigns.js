import { DEFAULT_MAILER_CALL_SCRIPT } from './default-call-script.js';
import { DEFAULT_MAIL_DOCUMENTS } from './default-mail-documents.js';

function parseMailDocumentsJson(raw) {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) {
      return parsed
        .map((doc) => ({
          label: String(doc.label ?? '').trim(),
          pdf_url: String(doc.pdf_url ?? '').trim(),
          source_file: doc.source_file ? String(doc.source_file).trim() : undefined,
          proof_copies: doc.proof_copies != null ? Number(doc.proof_copies) : undefined,
        }))
        .filter((doc) => doc.label && doc.pdf_url);
    }
  } catch {
    // fall through
  }
  return null;
}

function resolveMailDocuments(data) {
  const fromDb = Array.isArray(data?.mail_documents) ? data.mail_documents : null;
  if (fromDb?.length) {
    return fromDb
      .map((doc) => ({
        label: String(doc.label ?? '').trim(),
        pdf_url: String(doc.pdf_url ?? '').trim(),
        source_file: doc.source_file ? String(doc.source_file).trim() : undefined,
        proof_copies: doc.proof_copies != null ? Number(doc.proof_copies) : undefined,
      }))
      .filter((doc) => doc.label && doc.pdf_url);
  }

  const fromEnv = parseMailDocumentsJson(process.env.MAILER_MAIL_DOCUMENTS_JSON);
  if (fromEnv?.length) {
    return fromEnv;
  }

  return DEFAULT_MAIL_DOCUMENTS;
}

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
    const mail_documents = resolveMailDocuments(data);
    return {
      ...data,
      pdf_url: data.pdf_url?.trim() || process.env.MAILER_CURRENT_WEEK_PDF_URL || '',
      mail_documents,
      script_markdown:
        data.script_markdown?.trim() ||
        process.env.MAILER_DEFAULT_SCRIPT_MARKDOWN ||
        DEFAULT_MAILER_CALL_SCRIPT,
    };
  }

  return {
    week_label: process.env.MAILER_CURRENT_WEEK_LABEL || 'This week\'s mail',
    mail_drop_date: null,
    pdf_url: process.env.MAILER_CURRENT_WEEK_PDF_URL || '',
    mail_documents: resolveMailDocuments(null),
    script_markdown: process.env.MAILER_DEFAULT_SCRIPT_MARKDOWN || DEFAULT_MAILER_CALL_SCRIPT,
    is_active: true,
    source: 'env',
  };
}
