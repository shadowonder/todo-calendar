/**
 * AI Layer: OpenAI provider
 *
 * Responsibilities:
 * - handle OpenAI connection details and request/response adaptation
 * - expose provider-level methods for normal chat and structured output modes
 *
 * Non-responsibilities:
 * - do not orchestrate pipeline order
 * - do not choose provider routing
 * - do not validate business action arguments
 *
 * Future extension:
 * - progressively migrate OpenAI calls to Vercel AI SDK from this provider
 *   without changing pipeline.js / steps/.
 */
import OpenAI, { AzureOpenAI } from 'openai';
import { generateObject } from 'ai';
import { createOpenAI as createVercelOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import { buildThinkingPreview, sanitizeAssistantText } from '../../outputSanitizer.js';

const DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini';
const clientCache = new Map();
const vercelProviderCache = new Map();

const ACTION_ITEM_ZOD_SCHEMA = z.object({
  reason: z.string(),
  method: z.string(),
  args: z.array(z.any()),
});

const STRUCTURED_ACTION_ZOD_SCHEMA = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('noAction'),
    response: z.string().min(1),
    actions: z.array(ACTION_ITEM_ZOD_SCHEMA).max(0),
  }),
  z.object({
    action: z.literal('read'),
    response: z.string().min(1).nullable(),
    actions: z.array(ACTION_ITEM_ZOD_SCHEMA).min(1),
  }),
  z.object({
    action: z.literal('write'),
    response: z.string().min(1),
    actions: z.array(ACTION_ITEM_ZOD_SCHEMA).min(1),
  }),
]);

function resolveRequestedModel(connection) {
  const modelVersion = typeof connection?.modelVersion === 'string'
    ? connection.modelVersion.trim()
    : '';
  return modelVersion || DEFAULT_OPENAI_MODEL;
}

function isAzureMode(connection) {
  return connection?.azureEnabled === true;
}

/**
 * In Azure mode, `modelVersion` is repurposed as the API version string.
 */
function resolveAzureApiVersion(connection) {
  const apiVersion = typeof connection?.modelVersion === 'string'
    ? connection.modelVersion.trim()
    : '';
  if (!apiVersion) {
    throw new Error('Azure mode requires API Version in Settings -> Model Connection -> Model Version.');
  }
  return apiVersion;
}

function normalizeBaseURL(modelUrl) {
  const raw = typeof modelUrl === 'string' ? modelUrl.trim() : '';
  if (!raw) return undefined;

  try {
    const UrlCtor = globalThis?.URL;
    if (!UrlCtor) return raw;
    const url = new UrlCtor(raw);
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
 * Parse optional model-level headers from Settings.
 * The field is expected to be a JSON object string.
 */
function parseModelHeaders(rawHeaders) {
  const raw = typeof rawHeaders === 'string' ? rawHeaders.trim() : '';
  if (!raw) return undefined;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Model headers must be valid JSON in Settings -> Model Connection -> Model Headers.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Model headers must be a JSON object in Settings -> Model Connection -> Model Headers.');
  }

  const headers = {};
  for (const [key, value] of Object.entries(parsed)) {
    const name = String(key || '').trim();
    if (!name || value === null || value === undefined) continue;
    headers[name] = typeof value === 'string' ? value : String(value);
  }
  return headers;
}

function buildHeadersCacheKey(headers) {
  return headers ? JSON.stringify(headers) : '';
}

/**
 * Resolve all connection-dependent runtime options once per call.
 * This keeps request branches focused on transport differences only.
 */
function resolveConnectionContext(connection) {
  const apiKey = connection?.auth?.key?.trim();
  if (!apiKey) {
    throw new Error('OpenAI API key is empty. Please set it in Settings -> Model Connection -> API Key.');
  }

  const azureEnabled = isAzureMode(connection);
  return {
    apiKey,
    azureEnabled,
    azureApiVersion: azureEnabled ? resolveAzureApiVersion(connection) : '',
    baseURL: normalizeBaseURL(connection?.modelUrl),
    requestedModel: azureEnabled ? '' : resolveRequestedModel(connection),
    modelHeaders: parseModelHeaders(connection?.modelHeaders),
  };
}

function toOpenAIMessages(messages, systemPrompt) {
  const list = [];
  if (systemPrompt) list.push({ role: 'system', content: systemPrompt });

  for (const msg of messages || []) {
    const role = msg?.role === 'assistant' ? 'assistant' : 'user';
    const content = typeof msg?.content === 'string' ? msg.content : '';
    if (!content.trim()) continue;
    list.push({ role, content });
  }
  return list;
}

function toVercelPrompt(messages, systemPrompt) {
  const lines = [];
  if (systemPrompt) {
    lines.push('[SYSTEM]');
    lines.push(systemPrompt);
    lines.push('');
  }

  for (const msg of messages || []) {
    const role = msg?.role === 'assistant' ? 'ASSISTANT' : 'USER';
    const content = typeof msg?.content === 'string' ? msg.content.trim() : '';
    if (!content) continue;
    lines.push(`[${role}]`);
    lines.push(content);
    lines.push('');
  }

  return lines.join('\n').trim();
}

function extractText(content, trim = true) {
  let text = '';
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        return '';
      })
      .join('\n');
  }
  return trim ? text.trim() : text;
}

function emitStreamUpdate(onStream, rawText, model, done = false) {
  if (typeof onStream !== 'function') return;
  onStream({
    text: sanitizeAssistantText(rawText),
    thinkingPreview: buildThinkingPreview(rawText),
    done,
    meta: { model },
  });
}

function getElectronOpenAIBridge() {
  const db = globalThis?.window?.db || globalThis?.db;
  const fn = db?.ai?.chatOpenAI;
  return typeof fn === 'function' ? fn : null;
}

/**
 * Build either OpenAI or AzureOpenAI client with cache segregation by mode/options.
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
      baseURL,
      apiVersion: azureApiVersion,
      ...(modelHeaders ? { defaultHeaders: modelHeaders } : {}),
      dangerouslyAllowBrowser: true,
    })
    : new OpenAI({
      apiKey,
      baseURL,
      dangerouslyAllowBrowser: true,
    });
  clientCache.set(key, client);
  return client;
}

function getVercelProvider({ apiKey, baseURL, headers }) {
  const headerKey = buildHeadersCacheKey(headers);
  const key = `${baseURL || 'default'}::${apiKey}::${headerKey}`;
  if (vercelProviderCache.has(key)) return vercelProviderCache.get(key);

  const provider = createVercelOpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    ...(headers ? { headers } : {}),
  });
  vercelProviderCache.set(key, provider);
  return provider;
}

/**
 * Build chat completion payload with mode-specific shape.
 * Azure mode omits `model` because deployment is expected in the URL path.
 */
function buildChatRequestBody({ azureEnabled, requestedModel, openAIMessages, responseFormat, stream = false }) {
  const body = {
    temperature: 0.3,
    messages: openAIMessages,
    ...(stream ? { stream: true } : {}),
    ...(responseFormat ? { response_format: responseFormat } : {}),
  };
  if (!azureEnabled) {
    body.model = requestedModel;
  }
  return body;
}

export async function askWithOpenAI({
  connection,
  messages,
  systemPrompt,
  signal,
  onStream,
  responseFormat,
}) {
  const {
    apiKey,
    azureEnabled,
    azureApiVersion,
    baseURL,
    requestedModel,
    modelHeaders,
  } = resolveConnectionContext(connection);
  const openAIMessages = toOpenAIMessages(messages, systemPrompt);
  const electronOpenAI = responseFormat ? null : getElectronOpenAIBridge();
  const requestOptions = {
    ...(signal ? { signal } : {}),
    ...(modelHeaders ? { headers: modelHeaders } : {}),
  };

  if (electronOpenAI) {
    const response = await electronOpenAI({
      apiKey,
      modelUrl: baseURL || '',
      model: requestedModel || null,
      azureEnabled,
      apiVersion: azureApiVersion || null,
      modelHeaders: modelHeaders || null,
      messages: openAIMessages,
    });
    const rawText = extractText(response?.text);
    const text = sanitizeAssistantText(rawText);
    if (!text) throw new Error('OpenAI returned an empty response after sanitization.');
    if (typeof onStream === 'function') {
      emitStreamUpdate(onStream, rawText, response?.model || requestedModel, false);
      emitStreamUpdate(onStream, rawText, response?.model || requestedModel, true);
    }
    return {
      text,
      provider: 'openai',
      meta: { model: response?.model || requestedModel },
      thinkingPreview: buildThinkingPreview(rawText),
    };
  }

  const client = getClient({
    apiKey,
    baseURL,
    azureEnabled,
    azureApiVersion,
    modelHeaders,
  });

  // When structured JSON schema format is requested, keep non-streaming mode
  // to avoid provider-specific streaming format edge cases.
  const useStreaming = typeof onStream === 'function' && !responseFormat;

  if (useStreaming) {
    const stream = await client.chat.completions.create(
      buildChatRequestBody({
        azureEnabled,
        requestedModel,
        openAIMessages,
        stream: true,
      }),
      requestOptions
    );

    let rawText = '';
    let streamModel = requestedModel;
    for await (const chunk of stream) {
      if (typeof chunk?.model === 'string' && chunk.model.trim()) {
        streamModel = chunk.model;
      }
      const piece = extractText(chunk?.choices?.[0]?.delta?.content, false);
      if (!piece) continue;
      rawText += piece;
      emitStreamUpdate(onStream, rawText, streamModel, false);
    }

    const text = sanitizeAssistantText(rawText);
    if (!text) throw new Error('OpenAI returned an empty response after sanitization.');
    emitStreamUpdate(onStream, rawText, streamModel, true);
    return {
      text,
      provider: 'openai',
      meta: { model: streamModel },
      thinkingPreview: buildThinkingPreview(rawText),
    };
  }

  const completion = await client.chat.completions.create(
    buildChatRequestBody({
      azureEnabled,
      requestedModel,
      openAIMessages,
      responseFormat,
      stream: false,
    }),
    requestOptions
  );

  const rawContent = extractText(completion?.choices?.[0]?.message?.content);
  const text = sanitizeAssistantText(rawContent);
  if (!text) throw new Error('OpenAI returned an empty response after sanitization.');

  return {
    text,
    provider: 'openai',
    meta: {
      model: completion?.model || requestedModel,
    },
    thinkingPreview: buildThinkingPreview(rawContent),
  };
}

/**
 * Minimal Vercel AI SDK structured call path.
 * This is intentionally opt-in so existing OpenAI SDK behavior remains unchanged.
 */
export async function askWithOpenAIStructured({
  connection,
  messages,
  systemPrompt,
  signal,
}) {
  const { apiKey, azureEnabled, baseURL, requestedModel, modelHeaders } = resolveConnectionContext(connection);
  if (azureEnabled) {
    // Keep Azure structured mode on OpenAI SDK branch for consistent Azure request shape.
    return askWithOpenAI({
      connection,
      messages,
      systemPrompt,
      signal,
      responseFormat: { type: 'json_object' },
    });
  }

  const useVercelSdk = connection?.runtime?.openaiSdk === 'vercel-ai'
    || connection?.modelProvider === 'vercel-ai'
    || connection?.useVercelAiSdk === true;

  // If caller does not explicitly request Vercel SDK mode, use existing OpenAI SDK
  // with JSON-object mode. We keep schema validation in validation.step (zod),
  // which avoids OpenAI strict-schema subset limits for open-ended `args`.
  if (!useVercelSdk) {
    return askWithOpenAI({
      connection,
      messages,
      systemPrompt,
      signal,
      responseFormat: { type: 'json_object' },
    });
  }

  const provider = getVercelProvider({ apiKey, baseURL, headers: modelHeaders });
  const prompt = toVercelPrompt(messages, systemPrompt);
  const result = await generateObject({
    model: provider(requestedModel),
    schema: STRUCTURED_ACTION_ZOD_SCHEMA,
    prompt,
    temperature: 0.3,
    abortSignal: signal,
  });

  const text = JSON.stringify(result.object);
  return {
    text,
    provider: 'openai',
    meta: { model: requestedModel, sdk: 'vercel-ai' },
    thinkingPreview: '',
  };
}
