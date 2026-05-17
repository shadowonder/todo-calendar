/**
 * AI Layer: frontend chat adapter
 *
 * Responsibilities:
 * - route chat requests through the ai pipeline
 * - emit user-facing thinking updates (pipeline step + LLM thinking)
 * - map structured output into chat-friendly text
 *
 * Non-responsibilities:
 * - do not execute actions
 * - do not implement provider routing internals
 * - do not perform database/UI side effects directly
 *
 * Note:
 * - old provider logic in modelRouter/providers remains intact for rollback.
 */
import { runAiPipeline } from './pipeline.js';

function getLatestUserPrompt(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const msg = list[i];
    if (msg?.role !== 'user') continue;
    const content = typeof msg?.content === 'string' ? msg.content.trim() : '';
    if (content) return content;
  }
  return '';
}

function formatStructuredOutputForChat(payload) {
  const action = typeof payload?.action === 'string' ? payload.action : '';
  const response = typeof payload?.response === 'string' ? payload.response.trim() : '';

  if (action === 'write') {
    const reasonLines = Array.isArray(payload?.actions)
      ? payload.actions
        .map((item) => (typeof item?.reason === 'string' ? item.reason.trim() : ''))
        .filter(Boolean)
        .map((reason) => `- ${reason}`)
      : [];

    return [...reasonLines, response].filter(Boolean).join('\n');
  }

  return response;
}

function emitThinking(onStream, {
  stepText = '',
  llmThinking = '',
  meta = null,
  done = false,
  reset = false,
} = {}) {
  if (typeof onStream !== 'function') return;
  onStream({
    thinkingStep: stepText,
    llmThinkingPreview: llmThinking,
    // Backward-compatible field used by existing UI.
    thinkingPreview: llmThinking,
    done,
    reset,
    ...(meta ? { meta } : {}),
  });
}

export async function requestAssistantReply({
  connection,
  selectedDate,
  tasks,
  messages,
  signal,
  onStream,
}) {
  const userPrompt = getLatestUserPrompt(messages);
  let currentStepText = 'Preparing pipeline...';
  let currentLlmThinking = '';
  let latestMeta = null;

  emitThinking(onStream, {
    stepText: currentStepText,
    llmThinking: currentLlmThinking,
    done: false,
    reset: true,
  });

  const structured = await runAiPipeline({
    connection,
    userPrompt,
    selectedDate,
    tasks,
    allowRead: true,
    signal,
    onStep: (event) => {
      if (typeof event?.message === 'string' && event.message.trim()) {
        currentStepText = event.message.trim();
      }
      if (event?.meta) latestMeta = event.meta;
      emitThinking(onStream, {
        stepText: currentStepText,
        llmThinking: currentLlmThinking,
        meta: latestMeta,
      });
    },
    onStream: (event) => {
      if (event?.meta) latestMeta = event.meta;
      if (typeof event?.thinkingPreview === 'string') {
        currentLlmThinking = event.thinkingPreview;
      }
      emitThinking(onStream, {
        stepText: currentStepText,
        llmThinking: currentLlmThinking,
        meta: latestMeta,
        done: false,
        reset: Boolean(event?.reset),
      });
    },
  });
  console.log('[AI] Structured output:', structured);

  const text = formatStructuredOutputForChat(structured);
  console.log('[AI] Final chat response text:', text);
  return {
    text,
    provider: 'pipeline',
    meta: {
      ...(latestMeta || {}),
      pipeline: 'context -> preflight -> (optional) read-context -> (optional) llm -> validation',
      structuredAction: structured?.action || 'unknown',
      actionCount: Array.isArray(structured?.actions) ? structured.actions.length : 0,
    },
    structuredOutput: structured,
    thinkingPreview: currentLlmThinking,
  };
}
