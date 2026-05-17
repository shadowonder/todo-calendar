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

/**
 * Remove markdown fence wrappers and trim whitespace.
 * Used before JSON.parse to tolerate common model formatting noise.
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

/**
 * Convert zod issues into one compact human-readable error string.
 * This helps surface exact failure paths in logs/UI.
 */
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

/**
 * Parse raw provider output into a JSON object.
 * Accepted forms:
 * - `{ text: "<json>" }`
 * - direct object payload
 * - raw JSON string
 */
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

    if ('action' in rawOutput || 'type' in rawOutput || 'actions' in rawOutput) {
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

/**
 * Try parsing a string that might itself be a JSON object.
 * Used to recover from models that put JSON into `response` as a string.
 */
function tryParseEmbeddedJsonObject(text) {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) return null;
  if (!(raw.startsWith('{') && raw.endsWith('}'))) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Lightweight plain-object guard for normalization logic.
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Generic write atomicity gate.
 * Returns true when a `write` payload should be downgraded to `noAction`.
 *
 * Rules:
 * - write with empty actions => downgrade
 * - write action containing non-write methods => downgrade
 * - write action flagged as no-op by method-level `isNoOpArgs` => downgrade
 */
function shouldDowngradeWritePayload(payload, { writeProcessors = {} } = {}) {
  if (!isPlainObject(payload) || payload.action !== 'write') return false;
  const actions = Array.isArray(payload.actions) ? payload.actions : [];
  if (actions.length === 0) return true;

  return actions.some((item) => {
    const method = typeof item?.method === 'string' ? item.method : '';
    const writeSpec = writeProcessors?.[method];

    // write stage should not contain non-write methods.
    if (!writeSpec) return true;

    if (typeof writeSpec?.isNoOpArgs !== 'function') return false;
    return Boolean(writeSpec.isNoOpArgs(item?.args));
  });
}

/**
 * Preserve user-facing response but remove executable mutations.
 */
function downgradeWritePayloadToNoAction(payload) {
  return {
    ...payload,
    action: 'noAction',
    actions: [],
  };
}

/**
 * Backward-compatible payload normalization.
 *
 * Handles:
 * - legacy `type` key
 * - loose action aliases (`none`, `no_action`, ...)
 * - top-level method/args fallback
 * - embedded JSON string inside `response`
 */
function normalizeLegacyPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const normalized = { ...payload };

  // Legacy key compatibility: type -> action
  if (!('action' in normalized) && typeof normalized.type === 'string') {
    normalized.action = normalized.type;
  }

  // Loose action normalization for local models.
  if (typeof normalized.action === 'string') {
    const actionValue = normalized.action.trim();
    if (actionValue === 'none') normalized.action = 'noAction';
    if (actionValue === 'NO_ACTION') normalized.action = 'noAction';
    if (actionValue === 'no_action' || actionValue === 'no-action' || actionValue === 'NoAction') {
      normalized.action = 'noAction';
    }
  }

  // If actions is a single object, wrap as array.
  if (normalized.actions && !Array.isArray(normalized.actions) && typeof normalized.actions === 'object') {
    normalized.actions = [normalized.actions];
  }

  // If actions is missing but method/args appear at top-level, wrap into one action.
  if (!Array.isArray(normalized.actions) && typeof normalized.method === 'string') {
    normalized.actions = [{
      reason: typeof normalized.reason === 'string' ? normalized.reason : '',
      method: normalized.method,
      args: Array.isArray(normalized.args) ? normalized.args : [],
    }];
  }

  if (!('action' in normalized)) {
    normalized.action = Array.isArray(normalized.actions) && normalized.actions.length > 0
      ? 'read'
      : 'noAction';
  }

  if (!('response' in normalized)) {
    if (normalized.action === 'noAction') {
      if (typeof normalized.message === 'string') {
        normalized.response = normalized.message;
      } else if (typeof normalized.answer === 'string') {
        normalized.response = normalized.answer;
      } else if (typeof normalized.text === 'string') {
        normalized.response = normalized.text;
      } else {
        normalized.response = '';
      }
    } else {
      normalized.response = null;
    }
  }

  // Some local models return the whole JSON object as a string inside `response`.
  // Example:
  // {
  //   action: "noAction",
  //   response: "{\"action\":\"noAction\",\"response\":\"Hello\"}",
  //   actions: []
  // }
  // We unwrap nested object if shape is recognizable.
  if (typeof normalized.response === 'string') {
    const embedded = tryParseEmbeddedJsonObject(normalized.response);
    if (embedded) {
      if (typeof embedded.action === 'string' && !('action' in payload)) {
        normalized.action = embedded.action;
      }
      if (typeof embedded.response === 'string') {
        normalized.response = embedded.response;
      }
      if (Array.isArray(embedded.actions) && (!Array.isArray(normalized.actions) || normalized.actions.length === 0)) {
        normalized.actions = embedded.actions;
      }
    }
  }

  return normalized;
}

/**
 * Build zod schema for method name validation.
 * Uses enum when known method list is available.
 */
function buildMethodSchema(methodNames) {
  const uniqueMethodNames = [...new Set((methodNames || []).filter((item) => typeof item === 'string' && item.trim()))];
  if (uniqueMethodNames.length === 0) {
    return z.string().min(1, 'method must be a non-empty string.');
  }
  const tuple = uniqueMethodNames;
  return z.enum(tuple);
}

/**
 * Build action enum per pipeline stage.
 * llm stage disables `read` by passing allowRead=false.
 */
function buildActionSchema(allowRead) {
  return allowRead
    ? z.enum(['noAction', 'read', 'write'])
    : z.enum(['noAction', 'write']);
}

/**
 * Build the top-level structured output contract.
 * This validates shape/cardinality; per-method args are validated later.
 */
function buildBaseStructuredResponseSchema({ allowRead, methodNames }) {
  return z.object({
    action: buildActionSchema(allowRead),
    response: z.string().trim().min(1).nullable(),
    actions: z.array(
      z.object({
        reason: z.string().trim().min(1, 'reason must be a non-empty string.'),
        method: buildMethodSchema(methodNames),
        args: z.array(z.unknown()),
      })
    ),
  }).superRefine((value, ctx) => {
    if (value.action === 'noAction' && value.actions.length !== 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['actions'],
        message: 'When action is "noAction", actions must be [].',
      });
    }

    if ((value.action === 'read' || value.action === 'write') && value.actions.length < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['actions'],
        message: `When action is "${value.action}", actions must contain at least 1 item.`,
      });
    }

    if (value.action === 'noAction' && typeof value.response !== 'string') {
      ctx.addIssue({
        code: 'custom',
        path: ['response'],
        message: 'When action is "noAction", response must be a non-empty string.',
      });
    }

    if (value.action === 'write' && typeof value.response !== 'string') {
      ctx.addIssue({
        code: 'custom',
        path: ['response'],
        message: 'When action is "write", response must be a non-empty plain text statement.',
      });
    }

    // For read, response can stay null or non-empty string.
  });
}

/**
 * Merge read/write processor definitions for method lookup.
 */
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
  // Parse + normalize first, then apply strict top-level contract validation.
  const payload = normalizeLegacyPayload(parseStructuredPayload(rawOutput));
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
  // Validate every action against its zod tuple/object schema.
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

  // Final atomicity gate:
  // if write operations are semantically no-op/invalid, return noAction.
  if (shouldDowngradeWritePayload(payload, { writeProcessors })) {
    return downgradeWritePayloadToNoAction(payload);
  }

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
