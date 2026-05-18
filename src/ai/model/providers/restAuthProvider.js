/**
 * AI Layer: REST auth provider
 *
 * Simplified contract:
 * - send auth request with user-defined method/url/headers/body
 * - parse token directly with JSONPath
 * - return token string for OpenAI-compatible API key usage
 */
import axios from 'axios';
import { JSONPath } from 'jsonpath-plus';

function getElectronRestAuthBridge() {
  const db = globalThis?.window?.db || globalThis?.db;
  const fn = db?.ai?.requestRestAuth;
  return typeof fn === 'function' ? fn : null;
}

/**
 * Single JSON validator/parser used for both `headers` and `body` inputs.
 * Empty input returns the provided fallback value.
 */
function parseJsonInput(raw, fieldName, fallbackValue) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return fallbackValue;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${fieldName} must be valid JSON.`);
  }
}

/**
 * Normalize user shortcut like `api.response[0].token` to JSONPath style.
 */
function toJsonPath(responseField) {
  const raw = typeof responseField === 'string' ? responseField.trim() : '';
  const field = raw || 'token';
  return field.startsWith('$') ? field : `$.${field}`;
}

/**
 * Resolve REST auth token and expose it as a plain string API key.
 */
export async function resolveRestApiKey({
  connection,
  signal,
}) {
  const auth = connection?.auth || {};
  const url = typeof auth?.url === 'string' ? auth.url.trim() : '';
  if (!url) {
    throw new Error('REST API Auth URL is empty. Please set it in Settings -> Model Connection -> REST API.');
  }

  const method = String(auth?.method || '').toUpperCase() === 'GET' ? 'GET' : 'POST';
  const headers = parseJsonInput(auth?.headers, 'Headers', {});
  const body = parseJsonInput(auth?.requestBody, 'Body', null);
  const jsonPath = toJsonPath(auth?.responseField);

  // Desktop mode prefers main-process bridge to avoid renderer-side CORS limits.
  const bridge = getElectronRestAuthBridge();
  const bridgeResult = bridge
    ? await bridge({
      url,
      method,
      headers,
      body,
    })
    : null;

  const result = bridgeResult || await axios.request({
    url,
    method,
    headers,
    validateStatus: () => true,
    signal,
    ...(method === 'GET' && body && typeof body === 'object' && !Array.isArray(body)
      ? { params: body }
      : {}),
    ...(method === 'GET' && body !== null && (typeof body !== 'object' || Array.isArray(body))
      ? { params: { payload: JSON.stringify(body) } }
      : {}),
    ...(method === 'POST' && body !== null ? { data: body } : {}),
  });

  if (!(result?.status >= 200 && result?.status < 300)) {
    throw new Error(`REST API auth request failed: ${result?.status || 'unknown'}.`);
  }

  const token = JSONPath({
    path: jsonPath,
    json: result?.data ?? result?.json,
    wrap: false,
  });
  if (token === undefined || token === null || String(token).trim() === '') {
    throw new Error(`Response field not found or empty: ${jsonPath}`);
  }

  return String(token).trim();
}
