/**
 * AI Layer: pipeline step (llm)
 *
 * Responsibilities:
 * - pass prepared context into model router
 * - receive raw model output for downstream validation step
 *
 * Non-responsibilities:
 * - do not decide prompt assembly details
 * - do not import specific provider implementations directly
 * - do not validate structured output
 *
 * Note:
 * - this is only a pipeline node; modelRouter owns model selection logic.
 */
import { requestStructuredOutput } from '../model/modelRouter.js';

export async function runLlmStep({
  connection,
  context,
  signal,
  onStream,
} = {}) {
  return requestStructuredOutput({
    connection,
    context,
    signal,
    onStream,
  });
}
