/**
 * AI Layer: pipeline orchestrator
 *
 * Responsibilities:
 * - assemble the minimal AI flow order
 * - pass data between steps
 * - return final structured output
 *
 * Non-responsibilities:
 * - do not call OpenAI/WebLLM directly
 * - do not implement prompt details
 * - do not implement concrete validation rules
 *
 * Pipeline:
 * context.step -> llm.step -> validation.step
 */
import { runContextStep } from './steps/context.step.js';
import { runLlmStep } from './steps/llm.step.js';
import { runValidationStep } from './steps/validation.step.js';

function emitStepEvent(onStep, event) {
  if (typeof onStep !== 'function') return;
  onStep({
    ...event,
    timestamp: new Date().toISOString(),
  });
}

export async function runAiPipeline({
  connection,
  userPrompt,
  selectedDate,
  tasks,
  currentTime,
  timezone,
  allowRead = true,
  preferVercelSdk = false,
  signal,
  onStream,
  onStep,
} = {}) {
  emitStepEvent(onStep, {
    step: 'context',
    status: 'started',
    message: 'Step 1/3: building context',
  });
  const context = await runContextStep({
    userPrompt,
    selectedDate,
    tasks,
    currentTime,
    timezone,
    allowRead,
    preferVercelSdk,
  });
  emitStepEvent(onStep, {
    step: 'context',
    status: 'completed',
    message: 'Step 1/3 complete: context ready',
  });

  emitStepEvent(onStep, {
    step: 'llm',
    status: 'started',
    message: 'Step 2/3: calling model',
  });
  const rawModelOutput = await runLlmStep({
    connection,
    context,
    signal,
    onStream,
  });
  emitStepEvent(onStep, {
    step: 'llm',
    status: 'completed',
    message: 'Step 2/3 complete: model response received',
    meta: rawModelOutput?.meta || null,
  });

  emitStepEvent(onStep, {
    step: 'validation',
    status: 'started',
    message: 'Step 3/3: validating structured output',
  });
  let validated;
  try {
    validated = await runValidationStep({
      rawModelOutput,
      context,
    });
  } catch (error) {
    console.error('[AI Pipeline] Validation step failed.', {
      error,
      rawModelOutput,
      contextSummary: {
        timezone: context?.timezone,
        currentTime: context?.currentTime,
      },
    });
    emitStepEvent(onStep, {
      step: 'validation',
      status: 'failed',
      message: 'Step 3/3 failed: structured output validation error',
    });
    throw error;
  }
  emitStepEvent(onStep, {
    step: 'validation',
    status: 'completed',
    message: 'Step 3/3 complete: output validated',
  });

  return validated;
}
