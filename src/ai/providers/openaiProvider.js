import OpenAI from 'openai';
import { buildThinkingPreview, sanitizeAssistantText } from '../outputSanitizer.js';

const DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini';
const clientCache = new Map();

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

export async function askWithOpenAI({ connection, messages, systemPrompt, signal, onStream }) {
  const apiKey = connection?.auth?.key?.trim();
  if (!apiKey) {
    throw new Error('OpenAI API key is empty. Please set it in Settings -> Model Connection -> API Key.');
  }

  const baseURL = normalizeBaseURL(connection?.modelUrl);
  const requestedModel = resolveRequestedModel(connection);
  const electronOpenAI = getElectronOpenAIBridge();

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

  const useStreaming = typeof onStream === 'function';

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
