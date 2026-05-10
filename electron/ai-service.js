import OpenAI from 'openai';

const clientCache = new Map();
const DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini';

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

function getClient({ apiKey, baseURL }) {
  const key = `${baseURL || 'default'}::${apiKey}`;
  if (clientCache.has(key)) return clientCache.get(key);

  const client = new OpenAI({ apiKey, baseURL });
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

export async function chatOpenAI(payload = {}) {
  const apiKey = typeof payload?.apiKey === 'string' ? payload.apiKey.trim() : '';
  if (!apiKey) {
    throw new Error('OpenAI API key is empty.');
  }

  const model = typeof payload?.model === 'string' && payload.model.trim()
    ? payload.model.trim()
    : DEFAULT_OPENAI_MODEL;
  const baseURL = normalizeBaseURL(payload?.modelUrl);
  const messages = normalizeMessages(payload?.messages);
  const client = getClient({ apiKey, baseURL });

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.3,
    messages,
  });

  const text = extractText(completion?.choices?.[0]?.message?.content);
  if (!text) {
    throw new Error('OpenAI returned an empty response.');
  }

  return {
    text,
    model: completion?.model || model,
  };
}
