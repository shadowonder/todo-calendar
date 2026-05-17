import {
  buildPatternHintBlock,
  buildFieldPromptToken,
} from './actionValidation.js';

/**
 * Action Catalog
 *
 * This module is now the home for both:
 * - processor capability definitions
 * - prompt-facing catalog rendering
 *
 * That keeps the AI-facing contract in one place. When we rename a method,
 * change an argument, or tweak an effect description, the execution metadata
 * and prompt documentation stay together instead of drifting across files.
 */

export const READ_PROCESSORS = {
  getTasksByDate: {
    // `params` defines argument names; `fieldType` defines expected runtime types.
    params: ['date'],
    fieldType: ['Date_Day'],
    effect: 'Read visible tasks on one calendar day.',
    processor: async ({ api, args }) => api.getByDate(args[0]),
  },

  getGridTasks: {
    params: ['startDate', 'endDate'],
    fieldType: ['Date_Day', 'Date_Day'],
    effect: 'Read tasks in a date range (start/end).',
    processor: async ({ api, args }) => api.getGridTasks(args[0], args[1]),
  },

  getTaskById: {
    params: ['taskId'],
    fieldType: ['integer'],
    effect: 'Read one task by id.',
    processor: async ({ api, args }) => api.getById(args[0]),
  },

  searchTasks: {
    params: ['query'],
    fieldType: ['string'],
    effect: 'Full-text search tasks by keyword.',
    processor: async ({ api, args }) => api.search(args[0]),
  },

  searchTasksByTag: {
    params: ['tag'],
    fieldType: ['string'],
    effect: 'Search tasks by one tag.',
    processor: async ({ api, args }) => api.searchByTag(args[0]),
  },

  getMonthTaskCounts: {
    params: ['yearMonth'],
    fieldType: ['Date_Month'],
    effect: 'Read unfinished task counts for one month.',
    processor: async ({ api, args }) => api.getMonthCounts(args[0]),
  },

  getArchivedTasks: {
    params: [],
    fieldType: [],
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
    fieldType: [
      'Date_Day',
      'string',
      'string|null',
      'string|null',
      'string|null',
      'Date_Day|null',
      'Date_Day|null',
      'Date_Day|null',
      'integer|null',
      'string|null',
    ],
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
    fieldType: ['integer', 'object'],
    effect: 'Update task by id with a patch object.',
    processor: async ({ api, args }) => api.update(args[0], args[1]),
  },

  setTaskDone: {
    params: ['taskId', 'done', 'entryDate'],
    fieldType: ['integer', 'boolean', 'Date_Day'],
    effect: 'Set done/pending status for one task on one date entry.',
    processor: async ({ api, args }) => api.setDone(args[0], args[1], args[2]),
  },

  deleteTask: {
    params: ['taskId'],
    fieldType: ['integer'],
    effect: 'Soft-delete one task by id.',
    processor: async ({ api, args }) => api.delete(args[0]),
  },
};

/**
 * Markdown method table used directly in AI prompts.
 *
 * We intentionally render regex-style prompt tokens instead of raw field type
 * names, because the model should see the argument contract in the most direct
 * and machine-friendly format possible.
 *
 * The processor registry remains the source of truth for capability shape,
 * while `actionValidation` translates symbolic types into prompt-safe rules.
 */
export function buildProcessorInstructionTable({
  includeRead = true,
  includeWrite = true,
} = {}) {
  const rows = [
    ...(includeRead ? Object.entries(READ_PROCESSORS) : []),
    ...(includeWrite ? Object.entries(WRITE_PROCESSORS) : []),
  ];

  const hintBlock = buildPatternHintBlock();

  return [
    ...(hintBlock ? [hintBlock] : []),
    '| Method | Arg Rules | Effect |',
    '|--------|-----------|--------|',
    ...rows.map(([method, spec]) =>
      `| ${method}(${Array.isArray(spec?.params) ? spec.params.join(', ') : ''}) | [${(Array.isArray(spec?.fieldType) ? spec.fieldType : []).map((typeName) => buildFieldPromptToken(typeName)).join(', ')}] | ${typeof spec?.effect === 'string' ? spec.effect : ''} |`
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
    'Output JSON contract:',
    '- Return exactly one JSON object. No markdown. No extra text.',
    `- type must be one of: ${allowedTypes.join(', ')}`,
    '- actions must be an array.',
    '- If type is "noAction", actions must be [].',
    '- If type is "read" or "write", actions must contain one or more items.',
    '- Each action item must be:',
    '  {"reason": "...", "method": "...", "args": [...] }',
  ].join('\n');
}
