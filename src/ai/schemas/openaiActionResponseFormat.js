/**
 * AI Layer: schema adapter
 *
 * Responsibilities:
 * - adapt local JSON schema into OpenAI-compatible response_format payload
 * - provide a single place to tune schema metadata/name/strict mode
 *
 * Non-responsibilities:
 * - do not orchestrate pipeline
 * - do not validate runtime action arguments
 * - do not execute model calls directly
 *
 * Future extension:
 * - add adapters for other SDKs/providers while keeping schema source stable.
 */
import actionResponseSchema from './action-response.schema.json';

export const OPENAI_ACTION_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'todo_calendar_action_response',
    strict: true,
    schema: actionResponseSchema,
  },
};

export function getOpenAIActionResponseFormat({
  name = 'todo_calendar_action_response',
  strict = true,
} = {}) {
  return {
    type: 'json_schema',
    json_schema: {
      name,
      strict,
      schema: actionResponseSchema,
    },
  };
}
