import { assertImportAuthorized, extractImportSecret } from '../http.js';

export function assertLoDeskAuthorized(req, body = null) {
  return assertImportAuthorized(req, body);
}

export function getLoDeskSecretFromRequest(req, body = null) {
  return extractImportSecret(req, body).secret;
}
