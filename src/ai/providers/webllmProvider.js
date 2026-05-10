import { resolveNativeModelSelection } from '../nativeModels.js';

let cachedModelId = null;
let cachedEnginePromise = null;

function ensureWebGpu() {
  const gpu = globalThis?.navigator?.gpu;
  if (!gpu) {
    throw new Error('WebGPU is not available. Native(WebLLM) mode requires a WebGPU-capable device/browser.');
  }
}

async function getEngine(modelId) {
  if (cachedModelId === modelId && cachedEnginePromise) {
    return cachedEnginePromise;
  }

  const webllm = await import('@mlc-ai/web-llm');
  cachedModelId = modelId;
  cachedEnginePromise = webllm.CreateMLCEngine(modelId, {
    logLevel: 'WARN',
  }).catch((err) => {
    if (cachedModelId === modelId) {
      cachedModelId = null;
      cachedEnginePromise = null;
    }
    throw err;
  });
  return cachedEnginePromise;
}

function toWebLLMMessages(messages, systemPrompt) {
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

function extractContent(messageContent) {
  if (typeof messageContent === 'string') return messageContent.trim();
  if (Array.isArray(messageContent)) {
    return messageContent
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

export async function askWithWebLLM({ connection, messages, systemPrompt }) {
  ensureWebGpu();
  const plan = resolveNativeModelSelection(connection?.auth || {});
  const candidateModelIds =
    Array.isArray(plan.fallbackModelIds) && plan.fallbackModelIds.length > 0
      ? plan.fallbackModelIds
      : [plan.modelId];

  let lastError = null;

  for (const candidateModelId of candidateModelIds) {
    try {
      const engine = await getEngine(candidateModelId);
      const completion = await engine.chat.completions.create({
        messages: toWebLLMMessages(messages, systemPrompt),
        temperature: 0.3,
        max_tokens: 640,
      });

      const text = extractContent(completion?.choices?.[0]?.message?.content);
      if (!text) throw new Error('WebLLM returned an empty response.');

      return {
        text,
        provider: 'webllm',
        meta: {
          model: completion?.model || candidateModelId,
          selectedTier: plan.selectedTier,
          autoTier: plan.autoTier,
          fallbackUsed: candidateModelId !== plan.modelId,
        },
      };
    } catch (err) {
      lastError = err;
    }
  }

  const detail = lastError instanceof Error && lastError.message
    ? lastError.message
    : 'Unknown WebLLM error.';
  throw new Error(`Failed to load a usable native model. ${detail}`);
}
