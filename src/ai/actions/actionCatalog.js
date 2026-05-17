import { z } from 'zod';

/**
 * AI Layer: action capability contract
 *
 * Responsibilities:
 * - define which actions/methods AI is allowed to return
 * - define each method's args contract with zod
 * - provide prompt-facing action contract rendering
 *
 * Non-responsibilities:
 * - do not call models
 * - do not execute actions
 * - do not validate final model output payload shape
 *
 * Future extension:
 * - append new methods/capabilities here and keep schema enums in sync.
 */

const DATE_DAY_RULE = '/^\\d{4}-\\d{2}-\\d{2}$/';
const DATE_MONTH_RULE = '/^\\d{4}-\\d{2}$/';

const DATE_DAY_ARG = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe(DATE_DAY_RULE);

const DATE_MONTH_ARG = z
  .string()
  .regex(/^\d{4}-\d{2}$/)
  .describe(DATE_MONTH_RULE);

const STRING_ARG = z.string().describe('string');
const INTEGER_ARG = z.number().int().describe('integer');
const BOOLEAN_ARG = z.boolean().describe('boolean');
const OBJECT_ARG = z.record(z.string(), z.unknown()).describe('object');
const NULLABLE_STRING_ARG = z.string().nullable().describe('string|null');
const NULLABLE_INTEGER_ARG = z.number().int().nullable().describe('integer|null');
const NULLABLE_DATE_DAY_ARG = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .describe(`${DATE_DAY_RULE}|null`);

function getTupleItems(argsSchema) {
  return Array.isArray(argsSchema?.def?.items) ? argsSchema.def.items : [];
}

function getZodRuleToken(schema) {
  const description = typeof schema?.description === 'string' ? schema.description.trim() : '';
  if (description) return description;

  const typeName = schema?.def?.type;
  if (typeName === 'string') return 'string';
  if (typeName === 'number') return 'number';
  if (typeName === 'boolean') return 'boolean';
  if (typeName === 'object') return 'object';
  if (typeName === 'array') return 'array';
  if (typeName === 'null') return 'null';
  if (typeName === 'nullable') {
    const inner = getZodRuleToken(schema?.def?.innerType);
    return `${inner}|null`;
  }
  if (typeName === 'union') {
    const options = Array.isArray(schema?.def?.options) ? schema.def.options : [];
    return options.map(getZodRuleToken).join('|') || 'unknown';
  }
  return 'unknown';
}

function getArgRuleTokens(argsSchema) {
  return getTupleItems(argsSchema).map((item) => getZodRuleToken(item));
}

export const READ_PROCESSORS = {
  getTasksByDate: {
    params: ['date'],
    argsSchema: z.tuple([DATE_DAY_ARG]),
    effect: 'Read visible tasks on one calendar day.',
    processor: async ({ api, args }) => api.getByDate(args[0]),
  },

  getGridTasks: {
    params: ['startDate', 'endDate'],
    argsSchema: z.tuple([DATE_DAY_ARG, DATE_DAY_ARG]),
    effect: 'Read tasks in a date range (start/end).',
    processor: async ({ api, args }) => api.getGridTasks(args[0], args[1]),
  },

  getTaskById: {
    params: ['taskId'],
    argsSchema: z.tuple([INTEGER_ARG]),
    effect: 'Read one task by id.',
    processor: async ({ api, args }) => api.getById(args[0]),
  },

  searchTasks: {
    params: ['query'],
    argsSchema: z.tuple([STRING_ARG]),
    effect: 'Full-text search tasks by keyword.',
    processor: async ({ api, args }) => api.search(args[0]),
  },

  searchTasksByTag: {
    params: ['tag'],
    argsSchema: z.tuple([STRING_ARG]),
    effect: 'Search tasks by one tag.',
    processor: async ({ api, args }) => api.searchByTag(args[0]),
  },

  getMonthTaskCounts: {
    params: ['yearMonth'],
    argsSchema: z.tuple([DATE_MONTH_ARG]),
    effect: 'Read unfinished task counts for one month.',
    processor: async ({ api, args }) => api.getMonthCounts(args[0]),
  },

  getArchivedTasks: {
    params: [],
    argsSchema: z.tuple([]),
    effect: 'Read archived task list.',
    processor: async ({ api }) => api.getArchived(),
  },
};

export const WRITE_PROCESSORS = {
  createTask: {
    params: [
      'originDate',
      'title',
      'description',
      'tags',
      'taskType',
      'startDate',
      'endDate',
      'dueDate',
      'prioritized',
      'color',
    ],
    argsSchema: z.tuple([
      DATE_DAY_ARG,
      STRING_ARG,
      NULLABLE_STRING_ARG,
      NULLABLE_STRING_ARG,
      NULLABLE_STRING_ARG,
      NULLABLE_DATE_DAY_ARG,
      NULLABLE_DATE_DAY_ARG,
      NULLABLE_DATE_DAY_ARG,
      NULLABLE_INTEGER_ARG,
      NULLABLE_STRING_ARG,
    ]),
    effect:
      'Create a task. Args: originDate, title, description, tags, taskType, startDate, endDate, dueDate, prioritized, color.',
    processor: async ({ api, args }) => {
      const originDate = args[0];
      return api.create({
        origin_date: originDate,
        title: args[1],
        description: args[2] ?? '',
        tags: args[3] ?? '',
        task_type: args[4] ?? 'regular',
        start_date: args[5] ?? originDate,
        end_date: args[6] ?? null,
        due_date: args[7] ?? null,
        prioritized: args[8] ?? 0,
        color: args[9] ?? null,
      });
    },
  },

  updateTask: {
    params: ['taskId', 'patch'],
    argsSchema: z.tuple([INTEGER_ARG, OBJECT_ARG]),
    effect: 'Update task by id with a patch object.',
    processor: async ({ api, args }) => api.update(args[0], args[1]),
  },

  setTaskDone: {
    params: ['taskId', 'done', 'entryDate'],
    argsSchema: z.tuple([INTEGER_ARG, BOOLEAN_ARG, DATE_DAY_ARG]),
    effect: 'Set done/pending status for one task on one date entry.',
    processor: async ({ api, args }) => api.setDone(args[0], args[1], args[2]),
  },

  deleteTask: {
    params: ['taskId'],
    argsSchema: z.tuple([INTEGER_ARG]),
    effect: 'Soft-delete one task by id.',
    processor: async ({ api, args }) => api.delete(args[0]),
  },
};

/**
 * Markdown method table used directly in AI prompts.
 * We render compact arg rules from zod definitions to keep prompt + validator
 * aligned from one source of truth.
 */
export function buildProcessorInstructionTable({
  includeRead = true,
  includeWrite = true,
} = {}) {
  const rows = [
    ...(includeRead ? Object.entries(READ_PROCESSORS) : []),
    ...(includeWrite ? Object.entries(WRITE_PROCESSORS) : []),
  ];

  return [
    '| Method | Arg Rules | Effect |',
    '|--------|-----------|--------|',
    ...rows.map(([method, spec]) =>
      `| ${Array.isArray(spec?.params) ? `${method}(${spec.params.join(', ')})` : method} | [${getArgRuleTokens(spec?.argsSchema).join(', ')}] | ${typeof spec?.effect === 'string' ? spec.effect : ''} |`
    ),
  ].join('\n');
}

/**
 * Compact JSON contract used by both prompt stages.
 */
export function buildActionJsonContract({
  allowRead = true,
} = {}) {
  const allowedTypes = allowRead
    ? ['noAction', 'read', 'write']
    : ['noAction', 'write'];

  return [
    'JSON output contract summary:',
    '- Output exactly one JSON object.',
    `- action: one of ${allowedTypes.join(', ')}.`,
    '- response: required field.',
    '- noAction => response must be a non-empty final answer string.',
    '- read => response can be null or a non-empty helper string.',
    '- write => response must be a non-empty confirmation-style question that explains planned writes and asks user confirmation.',
    '- actions: required array.',
    '- noAction => actions must be empty.',
    '- read/write => actions must contain one or more items.',
    '- each action item keys: reason, method, args.',
  ].join('\n');
}
