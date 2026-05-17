/**
 * AI Layer: pipeline step (validation)
 *
 * Responsibilities:
 * - validate model output against structured output contract
 * - return verified structured payload to pipeline caller
 *
 * Non-responsibilities:
 * - do not execute actions
 * - do not write database
 * - do not render UI
 *
 * Note:
 * - this file is pipeline position only;
 *   concrete validation rules live in actions/actionValidation.js.
 */
import { READ_PROCESSORS, WRITE_PROCESSORS } from '../actions/actionCatalog.js';
import {
  parseStructuredActionResponseWithZod,
  validateActionArgsWithZod,
} from '../actions/actionValidation.js';

export async function runValidationStep({
  rawModelOutput,
  context,
} = {}) {
  const allowRead = context?.modelInput?.allowRead !== false;
  const methodNames = [
    ...Object.keys(READ_PROCESSORS),
    ...Object.keys(WRITE_PROCESSORS),
  ];

  try {
    const payload = parseStructuredActionResponseWithZod(rawModelOutput, {
      allowRead,
      methodNames,
    });

    return validateActionArgsWithZod(payload, {
      readProcessors: READ_PROCESSORS,
      writeProcessors: WRITE_PROCESSORS,
    });
  } catch (error) {
    const provider = typeof rawModelOutput?.provider === 'string' ? rawModelOutput.provider : '';
    const rawText = typeof rawModelOutput?.text === 'string' ? rawModelOutput.text.trim() : '';

    // Local model sometimes returns plain text instead of strict structured JSON.
    // We keep pipeline alive and surface a user-facing response instead of hard fail.
    if (provider === 'webllm' && rawText) {
      console.warn('[AI Validation][WebLLM] Structured output validation failed, fallback to noAction response.', {
        error,
        rawModelOutput,
      });
      return {
        action: 'noAction',
        response: rawText,
        actions: [],
      };
    }

    throw error;
  }
}
