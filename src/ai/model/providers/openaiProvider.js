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
import OpenAI from 'openai';
import { generateObject } from 'ai';
import { createOpenAI as createVercelOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import { buildThinkingPreview, sanitizeAssistantText } from '../../outputSanitizer.js';
import { getOpenAIActionResponseFormat } from '../../schemas/openaiActionResponseFormat.js';

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

function extractStreamText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        return '';
      })
      .join('\n');
  }
  return '';
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

function getClient({ apiKey, baseURL }) {
  const key = `${baseURL || 'default'}::${apiKey}`;
  if (clientCache.has(key)) return clientCache.get(key);

  const client = new OpenAI({
    apiKey,
    baseURL,
    dangerouslyAllowBrowser: true,
  });
  clientCache.set(key, client);
  return client;
}

function getVercelProvider({ apiKey, baseURL }) {
  const key = `${baseURL || 'default'}::${apiKey}`;
  if (vercelProviderCache.has(key)) return vercelProviderCache.get(key);

  const provider = createVercelOpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });
  vercelProviderCache.set(key, provider);
  return provider;
}

export async function askWithOpenAI({
  connection,
  messages,
  systemPrompt,
  signal,
  onStream,
  responseFormat,
}) {
  const apiKey = connection?.auth?.key?.trim();
  if (!apiKey) {
    throw new Error('OpenAI API key is empty. Please set it in Settings -> Model Connection -> API Key.');
  }

  const baseURL = normalizeBaseURL(connection?.modelUrl);
  const requestedModel = resolveRequestedModel(connection);
  const electronOpenAI = responseFormat ? null : getElectronOpenAIBridge();

  if (electronOpenAI) {
    const response = await electronOpenAI({
      apiKey,
      modelUrl: baseURL || '',
      model: requestedModel,
      messages: toOpenAIMessages(messages, systemPrompt),
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

  const client = getClient({ apiKey, baseURL });

  // When structured JSON schema format is requested, keep non-streaming mode
  // to avoid provider-specific streaming format edge cases.
  const useStreaming = typeof onStream === 'function' && !responseFormat;

  if (useStreaming) {
    const stream = await client.chat.completions.create(
      {
        model: requestedModel,
        temperature: 0.3,
        messages: toOpenAIMessages(messages, systemPrompt),
        stream: true,
      },
      { signal }
    );

    let rawText = '';
    let streamModel = requestedModel;
    for await (const chunk of stream) {
      if (typeof chunk?.model === 'string' && chunk.model.trim()) {
        streamModel = chunk.model;
      }
      const piece = extractStreamText(chunk?.choices?.[0]?.delta?.content);
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
    {
      model: requestedModel,
      temperature: 0.3,
      messages: toOpenAIMessages(messages, systemPrompt),
      ...(responseFormat ? { response_format: responseFormat } : {}),
    },
    { signal }
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
  const apiKey = connection?.auth?.key?.trim();
  if (!apiKey) {
    throw new Error('OpenAI API key is empty. Please set it in Settings -> Model Connection -> API Key.');
  }

  const baseURL = normalizeBaseURL(connection?.modelUrl);
  const requestedModel = resolveRequestedModel(connection);
  const useVercelSdk = connection?.runtime?.openaiSdk === 'vercel-ai'
    || connection?.modelProvider === 'vercel-ai'
    || connection?.useVercelAiSdk === true;

  // If caller does not explicitly request Vercel SDK mode, use existing OpenAI SDK
  // with JSON schema response_format for safer backward compatibility.
  if (!useVercelSdk) {
    return askWithOpenAI({
      connection,
      messages,
      systemPrompt,
      signal,
      responseFormat: getOpenAIActionResponseFormat(),
    });
  }

  const provider = getVercelProvider({ apiKey, baseURL });
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
