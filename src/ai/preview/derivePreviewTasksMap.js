/**
 * AI Preview Deriver
 *
 * Responsibilities:
 * - derive preview tasks map from immutable baseline tasks map + structured plan
 * - apply operations in order as a pure transformation
 * - annotate preview metadata (previewStatus / modified / previewKey)
 *
 * Non-responsibilities:
 * - do not mutate baseline map or baseline task objects
 * - do not write database
 * - do not trigger UI side effects
 */

const DATE_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalize one value into strict YYYY-MM-DD format.
 * Returns empty string when value is missing or invalid.
 */
function toDateDay(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return DATE_DAY_RE.test(text) ? text : '';
}

/**
 * Lightweight plain-object guard used by patch/merge helpers.
 */
function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Parse one value as finite number, otherwise return NaN.
 * Useful for robust numeric comparisons without throwing.
 */
function toNumberOrNaN(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Development-only warning helper.
 * Keeps production output clean while surfacing bad operations in dev.
 */
function warnDev(options, message, detail) {
  if (!options?.devMode) return;
  console.warn(`[AI Preview] ${message}`, detail);
}

/**
 * Ensure date bucket exists in preview map and return that array.
 */
function ensureDateBucket(map, date) {
  if (!Array.isArray(map[date])) map[date] = [];
  return map[date];
}

/**
 * Build stable key for baseline task rows to avoid React key collisions.
 */
function buildBaselinePreviewKey(task, date, index) {
  return `baseline:${String(task?.id ?? 'na')}:${date}:${index}`;
}

/**
 * Clone baseline map into preview map and annotate all rows as unchanged.
 * This is the immutability boundary for derived preview state.
 */
function cloneBaselineMap(databaseTasksMap = {}) {
  const output = {};
  for (const [date, rows] of Object.entries(databaseTasksMap || {})) {
    const list = Array.isArray(rows) ? rows : [];
    output[date] = list.map((task, index) => ({
      ...task,
      previewStatus: 'unchanged',
      modified: false,
      previewKey: buildBaselinePreviewKey(task, date, index),
    }));
  }
  return output;
}

/**
 * Find every row location that references the same task id.
 * A task can appear across multiple dates due to recurrence/history.
 */
function findLocationsByTaskId(previewMap, taskId) {
  const targetId = String(taskId);
  const locations = [];
  for (const [date, rows] of Object.entries(previewMap)) {
    if (!Array.isArray(rows)) continue;
    rows.forEach((task, index) => {
      if (String(task?.id) === targetId) {
        locations.push({ date, index, task });
      }
    });
  }
  return locations;
}

/**
 * Normalize update patch keys into canonical snake_case fields.
 * Also normalizes boolean flags to integer format expected by task rows.
 */
function normalizePatch(rawPatch) {
  if (!isRecord(rawPatch)) return {};
  const patch = { ...rawPatch };

  if (patch.start_date === undefined && patch.startDate !== undefined) patch.start_date = patch.startDate;
  if (patch.due_date === undefined && patch.dueDate !== undefined) patch.due_date = patch.dueDate;
  if (patch.end_date === undefined && patch.endDate !== undefined) patch.end_date = patch.endDate;
  if (patch.task_type === undefined && patch.taskType !== undefined) patch.task_type = patch.taskType;

  if (typeof patch.prioritized === 'boolean') patch.prioritized = patch.prioritized ? 1 : 0;
  if (typeof patch.done === 'boolean') patch.done = patch.done ? 1 : 0;

  return patch;
}

/**
 * Returns true when patch contains at least one key.
 * Used to suppress no-op update actions.
 */
function hasPatchChanges(patch) {
  return isRecord(patch) && Object.keys(patch).length > 0;
}

/**
 * Resolve move target date from patch by precedence:
 * start_date > due_date > end_date.
 */
function resolveMoveTargetDate(patch) {
  const startDate = toDateDay(patch?.start_date);
  if (startDate) return startDate;
  const dueDate = toDateDay(patch?.due_date);
  if (dueDate) return dueDate;
  const endDate = toDateDay(patch?.end_date);
  if (endDate) return endDate;
  return '';
}

/**
 * Apply whitelisted patch fields to one task object and return a new row.
 * Unknown keys are ignored intentionally to keep preview model stable.
 */
function applyPatchToTask(task, patch) {
  if (!task || !isRecord(patch)) return task;
  const next = { ...task };

  const directKeys = [
    'title',
    'description',
    'tags',
    'task_type',
    'start_date',
    'end_date',
    'due_date',
    'priority',
    'prioritized',
    'sort_order',
    'color',
    'done',
  ];

  for (const key of directKeys) {
    if (patch[key] === undefined) continue;
    next[key] = patch[key];
  }

  return next;
}

/**
 * Attach preview metadata (`previewStatus`, `modified`) to one task row.
 */
function setPreviewMeta(task, previewStatus) {
  if (!task) return task;
  return {
    ...task,
    previewStatus,
    modified: previewStatus !== 'unchanged',
  };
}

/**
 * Compute next sort_order value inside one date bucket.
 * New preview-created tasks are appended after existing max sort order.
 */
function nextSortOrderForDate(previewMap, date) {
  const rows = Array.isArray(previewMap?.[date]) ? previewMap[date] : [];
  let maxValue = 0;
  rows.forEach((row) => {
    const n = toNumberOrNaN(row?.sort_order);
    if (Number.isFinite(n)) maxValue = Math.max(maxValue, n);
  });
  return maxValue + 1;
}

/**
 * Build preview-only task row from `createTask` positional args.
 * Returns null when no valid target date can be resolved.
 */
function createPreviewTaskFromCreateAction(args, opIndex, previewMap) {
  const originDate = toDateDay(args[0]);
  const title = typeof args[1] === 'string' ? args[1].trim() : '';
  const description = typeof args[2] === 'string' ? args[2] : '';
  const tags = typeof args[3] === 'string' ? args[3] : '';
  const taskType = typeof args[4] === 'string' && args[4].trim() ? args[4].trim() : 'regular';
  const startDate = toDateDay(args[5]) || originDate;
  const endDate = toDateDay(args[6]) || null;
  const dueDate = toDateDay(args[7]) || null;
  const prioritized = Number.isFinite(Number(args[8])) ? Number(args[8]) : 0;
  const color = typeof args[9] === 'string' && args[9].trim() ? args[9].trim() : null;
  const targetDate = startDate || originDate;

  if (!targetDate) return null;

  const previewId = `preview:create:${opIndex}:${targetDate}`;
  return {
    id: previewId,
    previewKey: previewId,
    title: title || 'Untitled Task',
    description,
    tags,
    task_type: taskType,
    origin_date: originDate || targetDate,
    start_date: startDate || targetDate,
    end_date: endDate,
    due_date: dueDate,
    prioritized,
    color,
    done: 0,
    entry_status: 'pending',
    entry_date: targetDate,
    sort_order: nextSortOrderForDate(previewMap, targetDate),
    previewStatus: 'created',
    modified: true,
  };
}

/**
 * Apply one createTask operation into preview map.
 */
function applyCreateTask(previewMap, args, opIndex, options) {
  if (!Array.isArray(args)) {
    warnDev(options, 'createTask args is not an array, skip operation.', { args });
    return;
  }

  const createdTask = createPreviewTaskFromCreateAction(args, opIndex, previewMap);
  if (!createdTask) {
    warnDev(options, 'createTask has invalid origin/start date, skip operation.', { args });
    return;
  }

  ensureDateBucket(previewMap, createdTask.entry_date).push(createdTask);
}

/**
 * Apply one updateTask operation into preview map.
 * Handles both in-place updates and cross-date moves.
 */
function applyUpdateTask(previewMap, args, opIndex, options) {
  if (!Array.isArray(args) || args.length < 2) {
    warnDev(options, 'updateTask args is invalid, skip operation.', { args });
    return;
  }

  const taskId = args[0];
  const patch = normalizePatch(args[1]);
  // Defensive no-op guard for preview rendering:
  // empty patch should not create "updated" visual noise in calendar.
  if (!hasPatchChanges(patch)) {
    warnDev(options, 'updateTask patch is empty, skip operation.', { taskId, args });
    return;
  }
  const locations = findLocationsByTaskId(previewMap, taskId);

  if (locations.length === 0) {
    warnDev(options, 'updateTask points to a non-existent task id, skip operation.', { taskId, args });
    return;
  }

  const moveDate = resolveMoveTargetDate(patch);
  const primary = locations[0];

  if (moveDate && moveDate !== primary.date) {
    if (locations.length > 1) {
      warnDev(options, 'updateTask move found multiple rows with same task id; only first row is moved.', {
        taskId,
        matchedRows: locations.length,
      });
    }

    const oldRows = ensureDateBucket(previewMap, primary.date);
    const oldTask = oldRows[primary.index];
    if (!oldTask) return;

    oldRows[primary.index] = setPreviewMeta(oldTask, 'movedFrom');

    const movedTaskBase = applyPatchToTask(oldTask, patch);
    const movedTask = setPreviewMeta({
      ...movedTaskBase,
      entry_date: moveDate,
      previewKey: `preview:movedTo:${String(taskId)}:${opIndex}:${moveDate}`,
    }, 'movedTo');

    ensureDateBucket(previewMap, moveDate).push(movedTask);
    return;
  }

  locations.forEach((loc) => {
    const rows = ensureDateBucket(previewMap, loc.date);
    const current = rows[loc.index];
    if (!current) return;
    const updated = applyPatchToTask(current, patch);
    rows[loc.index] = setPreviewMeta(updated, 'updated');
  });
}

/**
 * Apply one deleteTask operation as soft-delete preview state.
 * We keep the row visible and mark it deleted instead of removing it.
 */
function applyDeleteTask(previewMap, args, options) {
  if (!Array.isArray(args) || args.length < 1) {
    warnDev(options, 'deleteTask args is invalid, skip operation.', { args });
    return;
  }

  const taskId = args[0];
  const locations = findLocationsByTaskId(previewMap, taskId);
  if (locations.length === 0) {
    warnDev(options, 'deleteTask points to a non-existent task id, skip operation.', { taskId, args });
    return;
  }

  locations.forEach((loc) => {
    const rows = ensureDateBucket(previewMap, loc.date);
    const current = rows[loc.index];
    if (!current) return;
    rows[loc.index] = setPreviewMeta(current, 'deleted');
  });
}

/**
 * Apply one setTaskDone operation.
 * Prefers matching the provided entryDate when available.
 */
function applySetTaskDone(previewMap, args, options) {
  if (!Array.isArray(args) || args.length < 2) {
    warnDev(options, 'setTaskDone args is invalid, skip operation.', { args });
    return;
  }

  const taskId = args[0];
  const doneFlag = Boolean(args[1]);
  const entryDate = toDateDay(args[2]);
  const locations = findLocationsByTaskId(previewMap, taskId);
  if (locations.length === 0) {
    warnDev(options, 'setTaskDone points to a non-existent task id, skip operation.', { taskId, args });
    return;
  }

  const preferredLocation = entryDate
    ? locations.find((loc) => loc.date === entryDate)
    : null;
  const target = preferredLocation || locations[0];
  const rows = ensureDateBucket(previewMap, target.date);
  const current = rows[target.index];
  if (!current) return;

  const entryStatus = doneFlag ? 'done' : 'pending';
  const updated = {
    ...current,
    done: doneFlag ? 1 : 0,
    entry_status: entryStatus,
  };
  rows[target.index] = setPreviewMeta(updated, 'updated');
}

/**
 * Derive preview tasks map from baseline grid tasks map and structured plan.
 *
 * @param {Record<string, Array<object>>} databaseTasksMap
 * @param {object|null} structuredPlan - `{ action, response, actions }`
 * @param {object} [options]
 * @param {boolean} [options.devMode]
 * @returns {Record<string, Array<object>>}
 */
export function derivePreviewTasksMap(databaseTasksMap, structuredPlan, options = {}) {
  // Baseline map is treated as immutable source of truth.
  // All mutations below happen on cloned preview map only.
  const baseline = databaseTasksMap && typeof databaseTasksMap === 'object'
    ? databaseTasksMap
    : {};

  if (!structuredPlan || structuredPlan.action === 'noAction') {
    return baseline;
  }

  const operations = Array.isArray(structuredPlan.actions) ? structuredPlan.actions : [];
  if (operations.length === 0) return baseline;

  const previewMap = cloneBaselineMap(baseline);

  // Apply operations in source order to preserve model intent.
  operations.forEach((operation, opIndex) => {
    const method = typeof operation?.method === 'string' ? operation.method : '';
    const args = Array.isArray(operation?.args) ? operation.args : [];

    switch (method) {
      case 'createTask':
        applyCreateTask(previewMap, args, opIndex, options);
        break;
      case 'updateTask':
        applyUpdateTask(previewMap, args, opIndex, options);
        break;
      case 'deleteTask':
        applyDeleteTask(previewMap, args, options);
        break;
      case 'setTaskDone':
        applySetTaskDone(previewMap, args, options);
        break;
      default:
        warnDev(options, `Unsupported preview method "${method}", skip operation.`, operation);
    }
  });

  return previewMap;
}
