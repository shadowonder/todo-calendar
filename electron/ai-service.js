import OpenAI, { AzureOpenAI } from 'openai';
import axios from 'axios';

const clientCache = new Map();
const DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini';

function buildHeadersCacheKey(headers) {
  return headers ? JSON.stringify(headers) : '';
}

function normalizeBaseURL(modelUrl) {
  const raw = typeof modelUrl === 'string' ? modelUrl.trim() : '';
  if (!raw) return undefined;

  try {
    const URLCtor = globalThis?.URL;
    if (!URLCtor) return raw;
    const url = new URLCtor(raw);
    if (url.pathname.endsWith('/chat/completions')) {
      url.pathname = url.pathname.replace(/\/chat\/completions$/, '');
    } else if (url.pathname.endsWith('/responses')) {
      url.pathname = url.pathname.replace(/\/responses$/, '');
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return raw;
  }
}

/**
 * Build either OpenAI or AzureOpenAI client, keyed by mode and headers to avoid cross-mode reuse.
 */
function getClient({
  apiKey,
  baseURL,
  azureEnabled = false,
  azureApiVersion = '',
  modelHeaders = undefined,
}) {
  const headerKey = buildHeadersCacheKey(modelHeaders);
  const key = `${azureEnabled ? 'azure' : 'openai'}::${baseURL || 'default'}::${apiKey}::${azureApiVersion}::${headerKey}`;
  if (clientCache.has(key)) return clientCache.get(key);

  const client = azureEnabled
    ? new AzureOpenAI({
      apiKey,
      endpoint: baseURL,
      apiVersion: azureApiVersion,
      ...(modelHeaders ? { defaultHeaders: modelHeaders } : {}),
    })
    : new OpenAI({ apiKey, baseURL });
  clientCache.set(key, client);
  return client;
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .map((msg) => ({
      role: msg?.role === 'assistant' ? 'assistant' : msg?.role === 'system' ? 'system' : 'user',
      content: typeof msg?.content === 'string' ? msg.content : '',
    }))
    .filter((msg) => msg.content.trim().length > 0);
}

function extractText(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        return '';
      })
      .join('\n')
      .trim();
  }
  return '';
}

function normalizeAuthMethod(method) {
  return String(method || '').toUpperCase() === 'GET' ? 'GET' : 'POST';
}

/**
 * Normalize a plain-object headers input by trimming keys and stringifying values.
 * Invalid shapes return the provided empty result (`{}` for auth, `undefined` for model headers).
 */
function normalizeHeadersObject(rawHeaders, emptyResult = {}) {
  if (!rawHeaders || typeof rawHeaders !== 'object' || Array.isArray(rawHeaders)) return emptyResult;
  const headers = {};
  for (const [key, value] of Object.entries(rawHeaders)) {
    const name = String(key || '').trim();
    if (!name) continue;
    if (value === null || value === undefined) continue;
    headers[name] = String(value);
  }
  return Object.keys(headers).length > 0 ? headers : emptyResult;
}

function isAzureMode(payload = {}) {
  return payload?.azureEnabled === true;
}

/**
 * In Azure mode, renderer sends API version via `modelVersion` semantic field.
 */
function resolveAzureApiVersion(payload = {}) {
  const apiVersion = typeof payload?.apiVersion === 'string'
    ? payload.apiVersion.trim()
    : '';
  if (!apiVersion) {
    throw new Error('Azure mode requires API Version.');
  }
  return apiVersion;
}

/**
 * Build chat body with provider-specific shape.
 * Azure mode omits `model` because deployment is expected in URL path.
 */
function buildChatBody({ azureEnabled, model, messages }) {
  const body = {
    temperature: 0.3,
    messages,
  };
  if (!azureEnabled && model) {
    body.model = model;
  }
  return body;
}

/**
 * Keep auth request options permissive and let upstream APIs return business errors.
 * We only normalize method/headers and pass body/params through.
 */
function buildRestAuthRequestConfig(payload = {}) {
  const method = normalizeAuthMethod(payload?.method);
  const headers = normalizeHeadersObject(payload?.headers, {});
  const body = payload?.body === undefined ? null : payload.body;
  return {
    url: typeof payload?.url === 'string' ? payload.url.trim() : '',
    method,
    headers,
    body,
  };
}

/**
 * Resolve chat payload once so transport code does not repeat parsing branches.
 */
function resolveChatPayload(payload = {}) {
  const apiKey = typeof payload?.apiKey === 'string' ? payload.apiKey.trim() : '';
  if (!apiKey) {
    throw new Error('OpenAI API key is empty.');
  }

  const azureEnabled = isAzureMode(payload);
  return {
    apiKey,
    azureEnabled,
    azureApiVersion: azureEnabled ? resolveAzureApiVersion(payload) : '',
    model: typeof payload?.model === 'string' && payload.model.trim()
      ? payload.model.trim()
      : DEFAULT_OPENAI_MODEL,
    baseURL: normalizeBaseURL(payload?.modelUrl),
    messages: normalizeMessages(payload?.messages),
    modelHeaders: normalizeHeadersObject(payload?.modelHeaders, undefined),
  };
}

export async function chatOpenAI(payload = {}) {
  const {
    apiKey,
    azureEnabled,
    azureApiVersion,
    model,
    baseURL,
    messages,
    modelHeaders,
  } = resolveChatPayload(payload);
  const client = getClient({
    apiKey,
    baseURL,
    azureEnabled,
    azureApiVersion,
    modelHeaders,
  });

  const completion = await client.chat.completions.create(
    buildChatBody({
      azureEnabled,
      model,
      messages,
    }),
    modelHeaders ? { headers: modelHeaders } : undefined
  );

  const text = extractText(completion?.choices?.[0]?.message?.content);
  if (!text) {
    throw new Error('OpenAI returned an empty response.');
  }

  return {
    text,
    model: completion?.model || model,
  };
}

export async function requestRestAuth(payload = {}) {
  const { url, method, headers, body } = buildRestAuthRequestConfig(payload);
  if (!url) {
    throw new Error('REST auth URL is empty.');
  }

  const response = await axios.request({
    url,
    method,
    headers,
    validateStatus: () => true,
    ...(method === 'GET' && body && typeof body === 'object' && !Array.isArray(body)
      ? { params: body }
      : {}),
    ...(method === 'GET' && body !== null && (typeof body !== 'object' || Array.isArray(body))
      ? { params: { payload: JSON.stringify(body) } }
      : {}),
    ...(method === 'POST' && body !== null ? { data: body } : {}),
  });

  return {
    status: response.status,
    data: response.data,
  };
}
