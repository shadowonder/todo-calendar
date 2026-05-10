import { buildSystemPrompt } from './prompt.js';
import { askWithOpenAI } from './providers/openaiProvider.js';
import { askWithWebLLM, preloadWebLLM, unloadWebLLM } from './providers/webllmProvider.js';

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .map((msg) => ({
      role: msg?.role === 'assistant' ? 'assistant' : 'user',
      content: typeof msg?.content === 'string' ? msg.content : '',
    }))
    .filter((msg) => msg.content.trim().length > 0);
}

export function getProviderLabel(connection) {
  if (connection?.type === 'native') return 'Native Model';
  if (connection?.type === 'apikey') return 'OpenAI';
  if (connection?.type === 'oauth') return 'OAuth (pending)';
  if (connection?.type === 'restapi') return 'REST API (pending)';
  return 'Unknown';
}

export async function requestAssistantReply({
  connection,
  selectedDate,
  tasks,
  messages,
  signal,
  onStream,
}) {
  const systemPrompt = buildSystemPrompt({ selectedDate, tasks });
  const normalizedMessages = normalizeMessages(messages);

  if (connection?.type === 'native') {
    return askWithWebLLM({
      connection,
      messages: normalizedMessages,
      systemPrompt,
      onStream,
    });
  }

  if (connection?.type === 'apikey') {
    return askWithOpenAI({
      connection,
      messages: normalizedMessages,
      systemPrompt,
      signal,
      onStream,
    });
  }

  if (connection?.type === 'oauth' || connection?.type === 'restapi') {
    throw new Error(`Connection type "${connection.type}" is not implemented yet for chat.`);
  }

  throw new Error('Unknown AI connection type. Please check Settings.');
}

export async function preloadNativeModel(connection) {
  if (connection?.type !== 'native') {
    throw new Error('Only native connection supports local model preloading.');
  }
  return preloadWebLLM({ connection });
}

export async function releaseNativeModel() {
  return unloadWebLLM();
}
