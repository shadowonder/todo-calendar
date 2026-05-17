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
