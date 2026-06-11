import crypto from 'crypto';

export const SESSION_COOKIE_NAME = 'qr_inbound_session';
export const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 7;

export function signSession(secret, email, { name, loName, isAdmin } = {}) {
  const payload = JSON.stringify({
    email: String(email).toLowerCase().trim(),
    name: name ? String(name).trim() : undefined,
    loName: loName ? String(loName).trim() : undefined,
    isAdmin: Boolean(isAdmin),
    exp: Date.now() + SESSION_MAX_AGE_SEC * 1000,
  });
  const payloadB64 = Buffer.from(payload, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

export function verifySession(secret, token) {
  if (!secret || !token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!data || typeof data.exp !== 'number' || data.exp < Date.now()) return null;
  if (!data.email || typeof data.email !== 'string') return null;
  return data;
}

export function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function getSessionFromReq(req) {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret) return null;
  const raw = req.headers?.cookie || '';
  const cookies = parseCookies(raw);
  return verifySession(secret, cookies[SESSION_COOKIE_NAME]);
}

export function sessionCookieHeader(token) {
  const secure =
    process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SEC}${secure}`;
}

export function clearSessionCookieHeader() {
  const secure =
    process.env.VERCEL || process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
