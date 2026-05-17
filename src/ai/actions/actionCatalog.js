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

/**
 * Generic "meaningful value" detector used by write no-op checks.
 * Purpose:
 * - distinguish empty placeholders (null/''/empty object) from real updates.
 */
function hasMeaningfulValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.some((item) => hasMeaningfulValue(item));
  if (typeof value === 'object') return Object.values(value).some((item) => hasMeaningfulValue(item));
  return true;
}

/**
 * Read tuple item definitions from a zod tuple schema.
 * Used to render prompt-facing arg rules from one source of truth.
 */
function getTupleItems(argsSchema) {
  return Array.isArray(argsSchema?.def?.items) ? argsSchema.def.items : [];
}

/**
 * Convert one zod schema node into a compact rule token for prompt tables.
 * Example output:
 * - string
 * - integer|null
 * - /^\\d{4}-\\d{2}-\\d{2}$/
 */
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

/**
 * Convert a method's args tuple into an ordered token list.
 * This preserves positional semantics for model output.
 */
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
      'Create a task. Args: originDate, title, description, tags, taskType, startDate, endDate, dueDate, prioritized, color. If a concrete target day is known, set originDate and startDate to that day; do not keep startDate null while only filling dueDate.',
    // No-op definition for atomic write safety.
    // If title/date signal is missing, this write action should be downgraded.
    isNoOpArgs: (args) => {
      if (!Array.isArray(args) || args.length < 2) return true;
      const title = typeof args[1] === 'string' ? args[1].trim() : '';
      const hasAnyDate = [args[0], args[5], args[6], args[7]].some((item) => hasMeaningfulValue(item));
      return !title || !hasAnyDate;
    },
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
    // No-op definition for atomic write safety.
    // Empty patch (or patch with only empty values) means "update nothing".
    isNoOpArgs: (args) => {
      if (!Array.isArray(args) || args.length < 2) return true;
      const patch = args[1];
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return true;
      return !Object.values(patch).some((item) => hasMeaningfulValue(item));
    },
    processor: async ({ api, args }) => api.update(args[0], args[1]),
  },

  setTaskDone: {
    params: ['taskId', 'done', 'entryDate'],
    argsSchema: z.tuple([INTEGER_ARG, BOOLEAN_ARG, DATE_DAY_ARG]),
    effect: 'Set done/pending status for one task on one date entry.',
    // No-op definition for atomic write safety.
    // Missing entryDate or missing args means this action is not executable.
    isNoOpArgs: (args) => !Array.isArray(args) || args.length < 3,
    processor: async ({ api, args }) => api.setDone(args[0], args[1], args[2]),
  },

  deleteTask: {
    params: ['taskId'],
    argsSchema: z.tuple([INTEGER_ARG]),
    effect: 'Soft-delete one task by id.',
    // No-op definition for atomic write safety.
    // Missing taskId means this action should not execute.
    isNoOpArgs: (args) => !Array.isArray(args) || args.length < 1,
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
  // We intentionally keep markdown table format because many models
  // parse tabular contracts more reliably than free-form text.
  const rows = [
    ...(includeRead ? Object.entries(READ_PROCESSORS) : []),
    ...(includeWrite ? Object.entries(WRITE_PROCESSORS) : []),
  ];

  return [
    'PROCESSOR_TABLE',
    '| Method | Args | Effect |',
    '|--------|------|--------|',
    ...rows.map(([method, spec]) => {
      const signature = Array.isArray(spec?.params) ? `${method}(${spec.params.join(', ')})` : method;
      const argRules = `[${getArgRuleTokens(spec?.argsSchema).join(', ')}]`;
      const effect = typeof spec?.effect === 'string' ? spec.effect : '';
      return `| ${signature} | ${argRules} | ${effect} |`;
    }),
  ].join('\n');
}

/**
 * Compact processor usage notes used by both prompt stages.
 * Keep this section short and only include high-impact field semantics.
 */
export function buildProcessorPromptNotes({
  includeRead = true,
  includeWrite = true,
} = {}) {
  // Keep notes short and high-impact to avoid token bloat.
  // These notes complement the table with behavior-critical semantics.
  const notes = [
    'PROCESSOR_NOTES',
    '- method must come from PROCESSOR_TABLE and cannot be null.',
  ];

  if (includeWrite) {
    notes.push('- if required write args are missing/ambiguous, return action=noAction with clarification response and actions=[].');
    notes.push('- createTask: if target date is explicit, originDate(args[0]) and startDate(args[5]) must both equal that date; dueDate(args[7]) cannot be the only concrete date.');
    notes.push('- updateTask: args[1] must be a patch object; never output key-value tuple encoding.');
    notes.push('- setTaskDone: entryDate(args[2]) is required and must match YYYY-MM-DD.');
    notes.push('- when action=write and args are complete, do not ask for execution confirmation.');
  }

  if (includeRead) {
    notes.push('- read methods are for retrieval only; do not mix write methods into action=read.');
  }

  return notes.join('\n');
}

/**
 * Compact JSON contract used by both prompt stages.
 */
export function buildActionJsonContract({
  allowRead = true,
} = {}) {
  // This contract is intentionally compact:
  // - one output skeleton
  // - action-specific cardinality/response rules
  // - a small set of hard forbids to reduce malformed outputs
  const allowedTypes = allowRead
    ? ['noAction', 'read', 'write']
    : ['noAction', 'write'];
  const readRule = allowRead
    ? '- read => response should be null by default; non-empty string is allowed only when strictly necessary, actions.length>=1.'
    : '- read => not allowed in this stage.';

  return [
    'ACTION_CONTRACT',
    `- OUT={"action":"${allowedTypes.join('|')}","response":"string|null","actions":[{"reason":"string","method":"<method>","args":[...]}]}`,
    '- noAction => response is non-empty string, actions=[].',
    readRule,
    '- write => response is non-empty plain statement describing planned changes, actions.length>=1.',
    '- action item keys must be exactly: reason, method, args.',
    '- FORBID markdown code fences.',
    '- FORBID multiple JSON objects or extra prose before/after JSON.',
    '- FORBID nested JSON string in response (response must be plain text or null for read).',
    '- FORBID args key-value tuple encoding; args must be a positional array.',
    '- FORBID confirmation request wording in write response.',
  ].join('\n');
}
