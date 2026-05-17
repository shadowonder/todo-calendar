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
 * context.step -> preflight.step -> (optional) read-context.step -> (optional) llm.step -> validation.step
 */
import { runContextStep } from './steps/context.step.js';
import { runPreflightStep } from './steps/preflight.step.js';
import { runReadContextStep } from './steps/read-context.step.js';
import { runLlmStep } from './steps/llm.step.js';
import { runValidationStep } from './steps/validation.step.js';
import { READ_PROCESSORS, WRITE_PROCESSORS } from './actions/actionCatalog.js';
import { parseStructuredActionResponseWithZod } from './actions/actionValidation.js';

function emitStepEvent(onStep, event) {
  if (typeof onStep !== 'function') return;
  onStep({
    ...event,
    timestamp: new Date().toISOString(),
  });
}

function resolvePreflightRoute(rawPreflightOutput, { allowRead = true } = {}) {
  const methodNames = [
    ...Object.keys(READ_PROCESSORS),
    ...Object.keys(WRITE_PROCESSORS),
  ];

  try {
    const payload = parseStructuredActionResponseWithZod(rawPreflightOutput, {
      allowRead,
      methodNames,
    });
    return payload?.action === 'noAction' || payload?.action === 'write'
      ? payload.action
      : 'read';
  } catch (error) {
    console.warn('[AI Pipeline] Preflight route parse failed, fallback to read.', {
      error,
      rawPreflightOutput,
    });
    return 'read';
  }
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
    message: 'Step 1/5: building context',
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
    message: 'Step 1/5 complete: context ready',
  });

  emitStepEvent(onStep, {
    step: 'preflight',
    status: 'started',
    message: 'Step 2/5: preflight model call',
  });
  const preflightRawOutput = await runPreflightStep({
    connection,
    context,
    signal,
    onStream,
  });
  const preflightRoute = resolvePreflightRoute(preflightRawOutput, { allowRead });
  emitStepEvent(onStep, {
    step: 'preflight',
    status: 'completed',
    message: `Step 2/5 complete: route=${preflightRoute}`,
    meta: {
      route: preflightRoute,
      skippedLlm: preflightRoute === 'noAction' || preflightRoute === 'write',
      preflightMeta: preflightRawOutput?.meta || null,
    },
  });

  let contextForLlm = context;
  let rawModelOutput;
  if (preflightRoute === 'noAction' || preflightRoute === 'write') {
    rawModelOutput = preflightRawOutput;
    emitStepEvent(onStep, {
      step: 'read-context',
      status: 'skipped',
      message: `Step 3/5 skipped: route=${preflightRoute}, no read data fetch`,
    });
    emitStepEvent(onStep, {
      step: 'llm',
      status: 'skipped',
      message: `Step 4/5 skipped: preflight returned ${preflightRoute}`,
    });
  } else {
    emitStepEvent(onStep, {
      step: 'read-context',
      status: 'started',
      message: 'Step 3/5: fetching read data from actionCatalog',
    });
    try {
      const readContextResult = await runReadContextStep({
        context,
        preflightRawOutput,
      });
      contextForLlm = readContextResult?.context || context;
      emitStepEvent(onStep, {
        step: 'read-context',
        status: 'completed',
        message: `Step 3/5 complete: fetched ${readContextResult?.fetchedTasks?.length || 0} visible task(s)`,
        meta: {
          executedReadActions: readContextResult?.executedReadActions || 0,
          fetchedTaskCount: readContextResult?.fetchedTasks?.length || 0,
        },
      });
    } catch (error) {
      console.error('[AI Pipeline] Read-context step failed, continue with original context.', {
        error,
        preflightRawOutput,
      });
      contextForLlm = context;
      emitStepEvent(onStep, {
        step: 'read-context',
        status: 'failed',
        message: 'Step 3/5 failed: continue with original visibleTasks',
      });
    }

    emitStepEvent(onStep, {
      step: 'llm',
      status: 'started',
      message: 'Step 4/5: calling model with fetched visibleTasks',
    });
    contextForLlm = {
      ...contextForLlm,
      modelInput: {
        ...(contextForLlm?.modelInput || {}),
        allowRead: false,
      },
    };
    rawModelOutput = await runLlmStep({
      connection,
      context: contextForLlm,
      signal,
      onStream,
    });
    emitStepEvent(onStep, {
      step: 'llm',
      status: 'completed',
      message: 'Step 4/5 complete: model response received',
      meta: rawModelOutput?.meta || null,
    });
  }

  emitStepEvent(onStep, {
    step: 'validation',
    status: 'started',
    message: 'Step 5/5: validating structured output',
  });

  let validated;
  try {
    validated = await runValidationStep({
      rawModelOutput,
      context: contextForLlm,
    });
  } catch (error) {
    console.error('[AI Pipeline] Validation step failed.', {
      error,
      rawModelOutput,
      contextSummary: {
        timezone: contextForLlm?.timezone,
        currentTime: contextForLlm?.currentTime,
      },
    });
    emitStepEvent(onStep, {
      step: 'validation',
      status: 'failed',
      message: 'Step 5/5 failed: structured output validation error',
    });
    throw error;
  }
  emitStepEvent(onStep, {
    step: 'validation',
    status: 'completed',
    message: 'Step 5/5 complete: output validated',
  });

  return validated;
}
