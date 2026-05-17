/**
 * AI Layer: pipeline step (preflight)
 *
 * Responsibilities:
 * - call the model once for preflight routing
 * - use the exact same request shape as llm.step
 * - return the exact same raw model output shape as llm.step
 *
 * Non-responsibilities:
 * - do not validate structured output contract
 * - do not execute actions
 * - do not perform database/UI side effects
 *
 * Note:
 * - preflight routing decision is handled by pipeline.js after this step returns.
 */
import { requestStructuredOutput } from '../model/modelRouter.js';

export async function runPreflightStep({
  connection,
  context,
  signal,
  onStream,
} = {}) {
  const stageContext = {
    ...(context || {}),
    modelInput: {
      ...(context?.modelInput || {}),
      systemPrompt: context?.modelInput?.preflightSystemPrompt
        || context?.modelInput?.systemPrompt
        || '',
    },
  };

  return requestStructuredOutput({
    connection,
    context: stageContext,
    signal,
    onStream,
  });
}
