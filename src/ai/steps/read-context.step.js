/**
 * AI Layer: pipeline step (read-context)
 *
 * Responsibilities:
 * - run preflight read actions through actionCatalog READ_PROCESSORS
 * - fetch read-only task data from renderer-exposed task API
 * - normalize fetched data into a task list for next LLM prompt visibleTasks
 *
 * Note:
 * - this step only runs when preflight route is "read".
 */
import { READ_PROCESSORS, WRITE_PROCESSORS } from '../actions/actionCatalog.js';
import {
  parseStructuredActionResponseWithZod,
  validateActionArgsWithZod,
} from '../actions/actionValidation.js';
import { buildLlmSystemPrompt } from '../prompts/basePrompt.js';

function toText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isTaskLikeObject(row) {
  return row && typeof row === 'object' && (
    'id' in row
    || 'title' in row
    || 'task_type' in row
    || 'start_date' in row
    || 'entry_date' in row
  );
}

function normalizeTaskRow(row, fallbackDate = '') {
  const title = toText(row?.title) || 'Untitled Task';
  const description = toText(row?.description);
  const entryDate = toText(row?.entry_date)
    || toText(row?.start_date)
    || toText(row?.origin_date)
    || toText(fallbackDate);

  const done = row?.done === 1 || row?.done === true ? 1 : 0;
  const entryStatus = toText(row?.entry_status) || (done ? 'done' : 'pending');
  const prioritized = row?.prioritized === 1 || row?.prioritized === true ? 1 : 0;

  return {
    id: typeof row?.id === 'number' ? row.id : null,
    title,
    description,
    prioritized,
    done,
    entry_status: entryStatus,
    entry_date: entryDate,
    task_type: toText(row?.task_type),
    tags: toText(row?.tags),
  };
}

function monthCountRows(countMap) {
  if (!countMap || typeof countMap !== 'object' || Array.isArray(countMap)) return [];
  return Object.entries(countMap).map(([date, count]) => normalizeTaskRow({
    id: null,
    title: `${Number(count) || 0} unfinished task(s)`,
    description: 'Monthly task count summary.',
    prioritized: 0,
    done: 0,
    entry_status: 'pending',
    entry_date: date,
    task_type: 'summary',
    tags: '',
  }, date));
}

function flattenResultToTasks(method, result) {
  if (method === 'getMonthTaskCounts') {
    return monthCountRows(result);
  }

  if (Array.isArray(result)) {
    return result
      .filter(isTaskLikeObject)
      .map((row) => normalizeTaskRow(row));
  }

  if (isTaskLikeObject(result)) {
    return [normalizeTaskRow(result)];
  }

  if (result && typeof result === 'object') {
    // getGridTasks returns: { 'YYYY-MM-DD': [rows...] }
    const flattened = [];
    for (const [date, rows] of Object.entries(result)) {
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (!isTaskLikeObject(row)) continue;
        flattened.push(normalizeTaskRow(row, date));
      }
    }
    return flattened;
  }

  return [];
}

function dedupeAndSortTasks(tasks) {
  const seen = new Set();
  const unique = [];

  for (const task of tasks) {
    const key = [
      task?.id ?? '',
      task?.entry_date ?? '',
      task?.title ?? '',
      task?.description ?? '',
    ].join('::');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(task);
  }

  unique.sort((a, b) => {
    const dateA = toText(a?.entry_date);
    const dateB = toText(b?.entry_date);
    if (dateA !== dateB) return dateA.localeCompare(dateB);

    const pA = Number(a?.prioritized) === 1 ? 1 : 0;
    const pB = Number(b?.prioritized) === 1 ? 1 : 0;
    if (pA !== pB) return pB - pA;

    return toText(a?.title).localeCompare(toText(b?.title));
  });

  return unique;
}

function getTaskReadApi() {
  const db = globalThis?.window?.db || globalThis?.db;
  const tasks = db?.tasks;
  if (!tasks) return null;

  return {
    getByDate: (date) => tasks.getByDate(date),
    getGridTasks: (startDate, endDate) => tasks.getGridTasks(startDate, endDate),
    getById: (id) => tasks.getById(id),
    search: (query) => tasks.search(query),
    searchByTag: (tag) => tasks.searchByTag(tag),
    getMonthCounts: (yearMonth) => tasks.getMonthCounts(yearMonth),
    getArchived: () => tasks.getArchived(),
  };
}

function getMethodNames() {
  return [
    ...Object.keys(READ_PROCESSORS),
    ...Object.keys(WRITE_PROCESSORS),
  ];
}

export async function runReadContextStep({
  context,
  preflightRawOutput,
} = {}) {
  const allowRead = context?.modelInput?.allowRead !== false;
  const preflightPayload = parseStructuredActionResponseWithZod(preflightRawOutput, {
    allowRead,
    methodNames: getMethodNames(),
  });

  const validatedPayload = validateActionArgsWithZod(preflightPayload, {
    readProcessors: READ_PROCESSORS,
    writeProcessors: WRITE_PROCESSORS,
  });

  const api = getTaskReadApi();
  if (!api) {
    console.warn('[AI ReadContext] No task read API available. Keep original visibleTasks.');
    return {
      context,
      fetchedTasks: [],
      executedReadActions: 0,
    };
  }

  const fetched = [];
  let executedReadActions = 0;

  for (const action of validatedPayload.actions) {
    const methodName = toText(action?.method);
    const spec = READ_PROCESSORS[methodName];
    if (!spec) {
      console.warn('[AI ReadContext] Skip non-read action from preflight route:', action);
      continue;
    }

    try {
      executedReadActions += 1;
      const result = await spec.processor({
        api,
        args: Array.isArray(action?.args) ? action.args : [],
      });
      fetched.push(...flattenResultToTasks(methodName, result));
    } catch (error) {
      console.error('[AI ReadContext] Read processor failed:', {
        method: methodName,
        args: action?.args,
        error,
      });
    }
  }

  const normalizedTasks = dedupeAndSortTasks(fetched);
  const promptTasks = normalizedTasks.length > 0
    ? normalizedTasks
    : (Array.isArray(context?.sourceTasks) ? context.sourceTasks : []);

  const nextLlmSystemPrompt = buildLlmSystemPrompt({
    selectedDate: context?.selectedDate,
    tasks: promptTasks,
    currentTime: context?.currentTime,
    timezone: context?.timezone,
    allowRead: false,
  });

  return {
    context: {
      ...context,
      preflightReadTasks: normalizedTasks,
      modelInput: {
        ...(context?.modelInput || {}),
        allowRead: false,
        llmSystemPrompt: nextLlmSystemPrompt,
      },
    },
    fetchedTasks: normalizedTasks,
    executedReadActions,
  };
}
