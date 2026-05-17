/**
 * AI Layer: WebLLM provider
 *
 * Responsibilities:
 * - manage browser/native WebLLM engine lifecycle
 * - execute WebLLM inference requests and stream text updates
 *
 * Non-responsibilities:
 * - do not route provider selection
 * - do not validate structured output contracts
 * - do not execute business actions
 *
 * Future extension:
 * - add richer candidate fallback policies and model warmup telemetry here.
 */
import { resolveNativeModelSelection } from '../../nativeModels.js';
import { buildThinkingPreview, sanitizeAssistantText } from '../../outputSanitizer.js';

let cachedModelId = null;
let cachedEnginePromise = null;
let engineOpsQueue = Promise.resolve();

function ensureWebGpu() {
  const gpu = globalThis?.navigator?.gpu;
  if (!gpu) {
    throw new Error('WebGPU is not available. Native(WebLLM) mode requires a WebGPU-capable device/browser.');
  }
}

function queueEngineOperation(task) {
  const run = engineOpsQueue.then(task, task);
  engineOpsQueue = run.catch(() => { });
  return run;
}

async function createEngine(modelId) {
  const webllm = await import('@mlc-ai/web-llm');
  return webllm.CreateMLCEngine(modelId, {
    logLevel: 'WARN',
  });
}

async function unloadEngine(enginePromise) {
  if (!enginePromise) return;
  try {
    const engine = await enginePromise;
    if (engine && typeof engine.unload === 'function') {
      await engine.unload();
    }
  } catch (_err) {
    // Ignore unload failure; next load will recreate the engine anyway.
  }
}

async function switchToModel(modelId) {
  if (cachedModelId === modelId && cachedEnginePromise) {
    return cachedEnginePromise;
  }

  const previousEnginePromise = cachedEnginePromise;
  cachedModelId = null;
  cachedEnginePromise = null;
  if (previousEnginePromise) {
    await unloadEngine(previousEnginePromise); // release old engine memory
  }

  cachedModelId = modelId;
  cachedEnginePromise = createEngine(modelId).catch((err) => {
    if (cachedModelId === modelId) {
      cachedModelId = null;
      cachedEnginePromise = null;
    }
    throw err;
  });
  return cachedEnginePromise;
}

function prioritizeCandidates(candidateModelIds) {
  if (!cachedModelId) return candidateModelIds;
  if (!candidateModelIds.includes(cachedModelId)) return candidateModelIds;
  return [cachedModelId, ...candidateModelIds.filter((id) => id !== cachedModelId)];
}

function resolveCandidatePlan(connection) {
  const plan = resolveNativeModelSelection(connection?.auth || {});
  const rawCandidates =
    Array.isArray(plan.fallbackModelIds) && plan.fallbackModelIds.length > 0
      ? plan.fallbackModelIds
      : [plan.modelId];

  return {
    plan,
    candidateModelIds: prioritizeCandidates(rawCandidates),
  };
}

async function loadBestCandidate(connection) {
  const { plan, candidateModelIds } = resolveCandidatePlan(connection);
  let lastError = null;

  for (const candidateModelId of candidateModelIds) {
    try {
      const engine = await switchToModel(candidateModelId);
      return { engine, modelId: candidateModelId, plan };
    } catch (err) {
      lastError = err;
    }
  }

  const detail = lastError instanceof Error && lastError.message
    ? lastError.message
    : 'Unknown WebLLM error.';
  throw new Error(`Failed to load a usable native model. ${detail}`);
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

function extractStreamContent(messageContent) {
  if (typeof messageContent === 'string') return messageContent;
  if (Array.isArray(messageContent)) {
    return messageContent
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        return '';
      })
      .join('\n');
  }
  return '';
}

function emitStreamUpdate(onStream, rawText, model, done = false, reset = false) {
  if (typeof onStream !== 'function') return;
  onStream({
    text: sanitizeAssistantText(rawText),
    thinkingPreview: buildThinkingPreview(rawText),
    done,
    reset,
    meta: { model },
  });
}

export async function askWithWebLLM({ connection, messages, systemPrompt, onStream }) {
  ensureWebGpu();
  return queueEngineOperation(async () => {
    const { plan, candidateModelIds } = resolveCandidatePlan(connection);
    const useStreaming = typeof onStream === 'function';
    let lastError = null;

    for (const candidateModelId of candidateModelIds) {
      try {
        const engine = await switchToModel(candidateModelId);

        if (useStreaming) {
          // Reset current assistant stream content when switching candidate model.
          emitStreamUpdate(onStream, '', candidateModelId, false, true);

          const chunks = await engine.chat.completions.create({
            messages: toWebLLMMessages(messages, systemPrompt),
            temperature: 0.5,
            repetition_penalty: 1.08,
            presence_penalty: 0.15,
            frequency_penalty: 0.2,
            enable_thinking: false,
            max_tokens: 640,
            stream: true,
            stream_options: { include_usage: true },
          });

          let rawText = '';
          let streamModel = candidateModelId;
          for await (const chunk of chunks) {
            if (typeof chunk?.model === 'string' && chunk.model.trim()) {
              streamModel = chunk.model;
            }
            const piece = extractStreamContent(chunk?.choices?.[0]?.delta?.content);
            if (!piece) continue;
            rawText += piece;
            emitStreamUpdate(onStream, rawText, streamModel, false);
          }

          if (typeof engine.getMessage === 'function') {
            const finalMessage = (await engine.getMessage().catch(() => '')) || '';
            if (finalMessage.length > rawText.length) {
              rawText = finalMessage;
            }
          }

          const text = sanitizeAssistantText(rawText);
          if (!text) {
            throw new Error('WebLLM produced no final answer text after sanitization.');
          }
          emitStreamUpdate(onStream, rawText, streamModel, true);
          return {
            text,
            provider: 'webllm',
            meta: {
              model: streamModel,
              selectedTier: plan.selectedTier,
              autoTier: plan.autoTier,
              fallbackUsed: candidateModelId !== plan.modelId,
            },
            thinkingPreview: buildThinkingPreview(rawText),
          };
        }

        const completion = await engine.chat.completions.create({
          messages: toWebLLMMessages(messages, systemPrompt),
          temperature: 0.5,
          repetition_penalty: 1.08,
          presence_penalty: 0.15,
          frequency_penalty: 0.2,
          enable_thinking: false,
          max_tokens: 640,
        });

        const text = sanitizeAssistantText(
          extractContent(completion?.choices?.[0]?.message?.content)
        );
        if (!text) throw new Error('WebLLM returned an empty response after sanitization.');

        return {
          text,
          provider: 'webllm',
          meta: {
            model: completion?.model || candidateModelId,
            selectedTier: plan.selectedTier,
            autoTier: plan.autoTier,
            fallbackUsed: candidateModelId !== plan.modelId,
          },
          thinkingPreview: buildThinkingPreview(
            extractContent(completion?.choices?.[0]?.message?.content)
          ),
        };
      } catch (err) {
        lastError = err;
      }
    }

    const detail = lastError instanceof Error && lastError.message
      ? lastError.message
      : 'Unknown WebLLM error.';
    throw new Error(`Failed to load a usable native model. ${detail}`);
  });
}

export async function preloadWebLLM({ connection }) {
  ensureWebGpu();
  return queueEngineOperation(async () => {
    const { modelId, plan } = await loadBestCandidate(connection);
    return {
      model: modelId,
      selectedTier: plan.selectedTier,
      autoTier: plan.autoTier,
      fallbackUsed: modelId !== plan.modelId,
    };
  });
}

export async function unloadWebLLM() {
  return queueEngineOperation(async () => {
    const previousEnginePromise = cachedEnginePromise;
    cachedModelId = null;
    cachedEnginePromise = null;
    await unloadEngine(previousEnginePromise);
  });
}
