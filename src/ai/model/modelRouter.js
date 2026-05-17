/**
 * AI Layer: model router
 *
 * Responsibilities:
 * - choose which model provider should handle a request
 * - keep pipeline/steps independent from provider details
 * - preserve current chat routing behavior for existing UI
 *
 * Non-responsibilities:
 * - do not execute business actions
 * - do not validate structured output contract
 * - do not perform database or UI operations
 *
 * Future extension:
 * - add Claude/Gemini/local providers by extending this router + providers/
 *   without changing pipeline orchestration.
 */
import { buildSystemPrompt } from '../prompts/basePrompt.js';
import { askWithOpenAI, askWithOpenAIStructured } from './providers/openaiProvider.js';
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

function buildStructuredMessages(context) {
  const userPrompt = typeof context?.userPrompt === 'string' ? context.userPrompt.trim() : '';
  const promptText = typeof context?.modelInput?.userPromptText === 'string'
    ? context.modelInput.userPromptText
    : userPrompt;

  return normalizeMessages([
    {
      role: 'user',
      content: promptText || 'No user prompt provided.',
    },
  ]);
}

/**
 * Structured output path used by pipeline llm.step.
 * The step passes context to this router; the router decides provider routing.
 */
export async function requestStructuredOutput({
  connection,
  context,
  signal,
  onStream,
}) {
  const systemPrompt = typeof context?.modelInput?.systemPrompt === 'string'
    ? context.modelInput.systemPrompt
    : '';
  const messages = buildStructuredMessages(context);

  if (connection?.type === 'native') {
    return askWithWebLLM({
      connection,
      messages,
      systemPrompt,
      onStream,
    });
  }

  if (connection?.type === 'apikey') {
    const preferVercelSdk = Boolean(context?.modelInput?.preferVercelSdk);
    return askWithOpenAIStructured({
      connection: preferVercelSdk
        ? { ...connection, useVercelAiSdk: true }
        : connection,
      messages,
      systemPrompt,
      signal,
    });
  }

  if (connection?.type === 'oauth' || connection?.type === 'restapi') {
    throw new Error(`Connection type "${connection.type}" is not implemented yet for structured output.`);
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
