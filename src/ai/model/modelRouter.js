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
import { resolveRestApiKey } from './providers/restAuthProvider.js';

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
  if (connection?.type === 'apikey') return connection?.azureEnabled ? 'Azure OpenAI' : 'OpenAI';
  if (connection?.type === 'restapi') return connection?.azureEnabled ? 'REST API Token (Azure)' : 'REST API Token';
  return 'Unknown';
}

async function resolveRestApiConnection(connection, signal) {
  const key = await resolveRestApiKey({ connection, signal });
  return {
    type: 'apikey',
    modelUrl: connection?.modelUrl || '',
    modelVersion: connection?.modelVersion || '',
    modelHeaders: connection?.modelHeaders || '',
    azureEnabled: connection?.azureEnabled === true,
    auth: { key },
  };
}

/**
 * Convert externally-configured auth modes into an OpenAI-compatible connection.
 * `apikey` is used directly; `restapi` is resolved into a temporary API key.
 */
async function resolveOpenAIConnection(connection, signal) {
  if (connection?.type === 'apikey') return connection;
  if (connection?.type === 'restapi') return resolveRestApiConnection(connection, signal);
  return null;
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

  const openAIConnection = await resolveOpenAIConnection(connection, signal);
  if (openAIConnection) {
    return askWithOpenAI({
      connection: openAIConnection,
      messages: normalizedMessages,
      systemPrompt,
      signal,
      onStream,
    });
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
  const preferVercelSdk = Boolean(context?.modelInput?.preferVercelSdk);

  if (connection?.type === 'native') {
    return askWithWebLLM({
      connection,
      messages,
      systemPrompt,
      onStream,
    });
  }

  const openAIConnection = await resolveOpenAIConnection(connection, signal);
  if (openAIConnection) {
    return askWithOpenAIStructured({
      connection: preferVercelSdk
        ? { ...openAIConnection, useVercelAiSdk: true }
        : openAIConnection,
      messages,
      systemPrompt,
      signal,
    });
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
