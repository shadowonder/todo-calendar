import { z } from 'zod';

/**
 * AI Layer: action validation implementation
 *
 * Responsibilities:
 * - parse raw model JSON response
 * - validate structured output contract with zod
 * - validate each action args against actionCatalog's zod argsSchema
 *
 * Non-responsibilities:
 * - do not orchestrate pipeline order (that belongs to validation.step)
 * - do not call model providers
 * - do not execute actions
 *
 * Future extension:
 * - if needed, split base response schema and method-args schema into smaller files.
 */

function normalizeRawJsonText(rawText) {
  const source = typeof rawText === 'string' ? rawText.trim() : '';
  if (!source) return '';
  return source
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function toZodErrorMessage(error, fallbackMessage) {
  if (!error?.issues || !Array.isArray(error.issues) || error.issues.length === 0) {
    return fallbackMessage;
  }

  const details = error.issues.map((issue) => {
    const path = Array.isArray(issue?.path) && issue.path.length > 0
      ? issue.path.join('.')
      : 'root';
    return `${path}: ${issue?.message || 'Invalid value.'}`;
  });
  return `${fallbackMessage} ${details.join('; ')}`;
}

function parseStructuredPayload(rawOutput) {
  if (rawOutput && typeof rawOutput === 'object' && !Array.isArray(rawOutput)) {
    if (typeof rawOutput.text === 'string') {
      const jsonText = normalizeRawJsonText(rawOutput.text);
      if (!jsonText) throw new Error('Model returned empty text for structured output.');
      try {
        return JSON.parse(jsonText);
      } catch (error) {
        throw new Error(`Structured output is not valid JSON: ${error instanceof Error ? error.message : 'Unknown parse error.'}`);
      }
    }

    if ('type' in rawOutput || 'actions' in rawOutput) {
      return rawOutput;
    }
  }

  if (typeof rawOutput === 'string') {
    const jsonText = normalizeRawJsonText(rawOutput);
    if (!jsonText) throw new Error('Model returned empty text for structured output.');
    try {
      return JSON.parse(jsonText);
    } catch (error) {
      throw new Error(`Structured output is not valid JSON: ${error instanceof Error ? error.message : 'Unknown parse error.'}`);
    }
  }

  throw new Error('Unsupported structured output payload type.');
}

function buildMethodSchema(methodNames) {
  const uniqueMethodNames = [...new Set((methodNames || []).filter((item) => typeof item === 'string' && item.trim()))];
  if (uniqueMethodNames.length === 0) {
    return z.string().min(1, 'method must be a non-empty string.');
  }
  const tuple = uniqueMethodNames;
  return z.enum(tuple);
}

function buildTypeSchema(allowRead) {
  return allowRead
    ? z.enum(['noAction', 'read', 'write'])
    : z.enum(['noAction', 'write']);
}

function buildBaseStructuredResponseSchema({ allowRead, methodNames }) {
  return z.object({
    type: buildTypeSchema(allowRead),
    actions: z.array(
      z.object({
        reason: z.string().trim().min(1, 'reason must be a non-empty string.'),
        method: buildMethodSchema(methodNames),
        args: z.array(z.unknown()),
      })
    ),
  }).superRefine((value, ctx) => {
    if (value.type === 'noAction' && value.actions.length !== 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['actions'],
        message: 'When type is "noAction", actions must be [].',
      });
    }

    if ((value.type === 'read' || value.type === 'write') && value.actions.length < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['actions'],
        message: `When type is "${value.type}", actions must contain at least 1 item.`,
      });
    }
  });
}

function buildMethodSpecMap({ readProcessors, writeProcessors }) {
  return {
    ...(readProcessors || {}),
    ...(writeProcessors || {}),
  };
}

/**
 * Parse + validate JSON response shape using zod.
 * This is the first validation pass used by validation.step.
 */
export function parseStructuredActionResponseWithZod(rawOutput, {
  allowRead = true,
  methodNames = [],
} = {}) {
  const payload = parseStructuredPayload(rawOutput);
  const baseSchema = buildBaseStructuredResponseSchema({
    allowRead,
    methodNames,
  });

  const result = baseSchema.safeParse(payload);
  if (!result.success) {
    throw new Error(toZodErrorMessage(result.error, 'Structured output contract validation failed.'));
  }
  return result.data;
}

/**
 * Validate each action args using argsSchema declared in actionCatalog.
 */
export function validateActionArgsWithZod(payload, {
  readProcessors = {},
  writeProcessors = {},
} = {}) {
  const methodSpecMap = buildMethodSpecMap({ readProcessors, writeProcessors });

  payload.actions.forEach((action, index) => {
    const spec = methodSpecMap[action.method];
    if (!spec) {
      throw new Error(`actions[${index}].method "${action.method}" is not defined in action catalog.`);
    }

    if (!spec.argsSchema || typeof spec.argsSchema.safeParse !== 'function') {
      throw new Error(`actions[${index}].method "${action.method}" is missing argsSchema.`);
    }

    const argsResult = spec.argsSchema.safeParse(action.args);
    if (!argsResult.success) {
      throw new Error(toZodErrorMessage(
        argsResult.error,
        `actions[${index}].args validation failed for "${action.method}".`
      ));
    }
  });

  return payload;
}

/**
 * Full structured output validation entry.
 * Kept for compatibility with existing callers.
 */
export function validateStructuredActionResponse(rawOutput, {
  readProcessors = {},
  writeProcessors = {},
  allowRead = true,
} = {}) {
  const methodNames = Object.keys(buildMethodSpecMap({ readProcessors, writeProcessors }));
  const payload = parseStructuredActionResponseWithZod(rawOutput, {
    allowRead,
    methodNames,
  });

  return validateActionArgsWithZod(payload, {
    readProcessors,
    writeProcessors,
  });
}
