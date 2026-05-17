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
} = {}) {
  const context = await runContextStep({
    userPrompt,
    selectedDate,
    tasks,
    currentTime,
    timezone,
    allowRead,
    preferVercelSdk,
  });

  const rawModelOutput = await runLlmStep({
    connection,
    context,
    signal,
    onStream,
  });

  return runValidationStep({
    rawModelOutput,
    context,
  });
}
