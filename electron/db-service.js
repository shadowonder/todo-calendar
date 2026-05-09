/**
 * db-service.js — all database operations (main process only)
 */
import { getDb } from './db.js';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function logAction(type, entityType, entityId, description) {
  try {
    getDb()
      .prepare(`INSERT INTO actions (action_type, entity_type, entity_id, description) VALUES (?,?,?,?)`)
      .run(type, entityType, entityId, description);
  } catch (e) { console.error('[DB] logAction failed:', e); }
}

function formatYmd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Add days to a YYYY-MM-DD string, returns YYYY-MM-DD */
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return formatYmd(d);
}

/** Today as YYYY-MM-DD */
function today() {
  return formatYmd(new Date());
}

function nextEntrySortOrder(entryDate) {
  const row = getDb()
    .prepare(`SELECT MAX(sort_order) AS m FROM task_day_entries WHERE entry_date = ?`)
    .get(entryDate);
  return (row?.m ?? 0) + 1;
}

function ensureEntryForDate(taskId, entryDate) {
  getDb().prepare(`
    INSERT OR IGNORE INTO task_day_entries (task_id, entry_date, status, sort_order)
    VALUES (?, ?, 'pending', ?)
  `).run(taskId, entryDate, nextEntrySortOrder(entryDate));
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY ENSURER
//
// For every active (!done, !archived, !deleted) task that should appear on
// `date`, ensure a task_day_entry row exists. This is not rollover logic.
// ─────────────────────────────────────────────────────────────────────────────
function ensureEntriesForDate(date) {
  const db = getDb();

  // Active tasks that should appear on `date` by their own schedule.
  // Non-range tasks appear only on start_date.
  const candidates = db.prepare(`
    SELECT * FROM tasks
    WHERE deleted = 0
      AND archived = 0
      AND done = 0
      AND (
        (task_type IN ('regular', 'one_day', 'due_date') AND start_date = ?)
     OR (task_type = 'future' AND start_date <= ? AND end_date >= ?)
      )
  `).all(date, date, date);

  for (const task of candidates) {
    ensureEntryForDate(task.id, date);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
export const config = {
  get(key) {
    return getDb().prepare('SELECT value FROM config WHERE key = ?').get(key)?.value ?? null;
  },
  set(key, value) {
    getDb().prepare(`
      INSERT INTO config (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, String(value));
    logAction('config.set', 'config', key, `Set config "${key}"`);
  },
  getAll() { return getDb().prepare('SELECT key, value, updated_at FROM config').all(); },
  delete(key) {
    getDb().prepare('DELETE FROM config WHERE key = ?').run(key);
    logAction('config.delete', 'config', key, `Deleted config "${key}"`);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// TASKS
// ─────────────────────────────────────────────────────────────────────────────
export const tasks = {

  /**
   * Get all tasks (with their day entry) for a specific date.
   * Ensures entries exist before querying.
   */
  getByDate(date) {
    ensureEntriesForDate(date);
    const baseRows = getDb().prepare(`
      SELECT t.*,
             e.id AS entry_id,
             CASE WHEN e.status = 'done' THEN 'done' ELSE 'pending' END AS entry_status,
             e.note AS entry_note,
             e.entry_date,
             e.sort_order AS sort_order
      FROM task_day_entries e
      JOIN tasks t ON t.id = e.task_id
      WHERE e.entry_date = ?
        AND t.deleted   = 0
        AND t.archived  = 0
        AND (
          t.task_type = 'future'
          OR e.entry_date = t.start_date
        )
      ORDER BY e.sort_order ASC, e.created_at ASC, e.id ASC
    `).all(date);

    // Display-only rollover:
    // when viewing today, also include unfinished tasks from previous days and
    // mark them as `rolled` in the UI. No DB writes are performed.
    if (date !== today()) return baseRows;

    const rolledRows = getDb().prepare(`
      SELECT
        t.*,
        NULL AS entry_id,
        'rolled' AS entry_status,
        NULL AS entry_note,
        t.start_date AS entry_date,
        t.priority AS sort_order
      FROM tasks t
      WHERE t.deleted = 0
        AND t.archived = 0
        AND t.done = 0
        AND t.start_date < ?
        AND NOT (
          t.task_type = 'future'
          AND t.start_date <= ?
          AND t.end_date >= ?
        )
      ORDER BY t.priority ASC, t.id ASC
    `).all(date, date, date);

    return [...rolledRows, ...baseRows];
  },

  /**
   * Get badge counts for every day in a month — single query for the calendar grid.
   * @param {string} yearMonth  e.g. '2026-05'
   * @returns {object}  { 'YYYY-MM-DD': count, ... }
   */
  getMonthCounts(yearMonth) {
    const start = `${yearMonth}-01`;
    // Compute last day of month
    const [y, m] = yearMonth.split('-').map(Number);
    const end = formatYmd(new Date(y, m, 0));

    // Ensure entries exist for every day in the month up to today
    const todayStr = today();
    let cursor = start;
    while (cursor <= end && cursor <= todayStr) {
      ensureEntriesForDate(cursor);
      cursor = addDays(cursor, 1);
    }

    const rows = getDb().prepare(`
      SELECT e.entry_date, COUNT(*) AS count
      FROM task_day_entries e
      JOIN tasks t ON t.id = e.task_id
      WHERE e.entry_date >= ? AND e.entry_date <= ?
        AND t.done = 0
        AND t.deleted  = 0
        AND t.archived = 0
        AND (
          t.task_type = 'future'
          OR e.entry_date = t.start_date
        )
      GROUP BY e.entry_date
    `).all(start, end);

    const result = {};
    for (const row of rows) result[row.entry_date] = row.count;
    return result;
  },

  /**
   * Get all tasks for a date range (used by the 42-cell calendar grid).
   * Returns: { 'YYYY-MM-DD': [ { id, title, entry_status, done, prioritized, ... }, ... ], ... }
   * @param {string} startDate  first cell date, e.g. '2026-04-27'
   * @param {string} endDate    last  cell date, e.g. '2026-06-07'
   */
  getGridTasks(startDate, endDate) {
    // Ensure ledger entries exist for each date up to today.
    const todayStr = today();
    let cursor = startDate;
    while (cursor <= endDate && cursor <= todayStr) {
      ensureEntriesForDate(cursor);
      cursor = addDays(cursor, 1);
    }

    const rows = getDb().prepare(`
      SELECT t.id, t.title, t.prioritized, t.done, t.task_type, t.color,
             e.sort_order AS sort_order, t.priority,
             e.entry_date,
             CASE WHEN e.status = 'done' THEN 'done' ELSE 'pending' END AS entry_status
      FROM task_day_entries e
      JOIN tasks t ON t.id = e.task_id
      WHERE e.entry_date >= ? AND e.entry_date <= ?
        AND t.deleted  = 0
        AND t.archived = 0
        AND (
          t.task_type = 'future'
          OR e.entry_date = t.start_date
        )
      ORDER BY e.entry_date ASC, e.sort_order ASC, t.id ASC
    `).all(startDate, endDate);

    // Group by entry_date
    const result = {};
    for (const row of rows) {
      if (!result[row.entry_date]) result[row.entry_date] = [];
      result[row.entry_date].push(row);
    }
    return result;
  },

  getById(id) {
    return getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  },

  /**
   * Create a new task and insert its first day entry.
   * @param {object} p
   * @param {string} p.origin_date
   * @param {string} p.title
   * @param {string} [p.description]
   * @param {string} [p.tags]           comma-separated
   * @param {string} [p.task_type]      'regular'|'one_day'|'due_date'|'future'
   * @param {string} [p.start_date]     defaults to origin_date
   * @param {string} [p.end_date]       required for 'future'
   * @param {string} [p.due_date]       required for 'due_date'
   */
  create({ origin_date, title, description = '', tags = '',
    task_type = 'regular', start_date, end_date = null, due_date = null,
    prioritized = 0, color = null }) {
    const sd = start_date || origin_date;

    // Keep task-level sort_order for legacy/read-only paths (search, exports).
    // Day-level ordering is persisted in task_day_entries.sort_order.
    const maxTaskSort = getDb().prepare(`
      SELECT MAX(sort_order) AS m FROM tasks
      WHERE deleted = 0
    `).get();
    const sort_order = (maxTaskSort?.m ?? 0) + 1.0;

    // Rolled-task display order (used when this task appears in today's rolled section).
    const maxPriority = getDb().prepare(`
      SELECT MAX(priority) AS m FROM tasks
      WHERE deleted = 0
    `).get();
    const priority = (maxPriority?.m ?? 0) + 1;

    const result = getDb().prepare(`
      INSERT INTO tasks (task_type, title, description, tags, origin_date, start_date, end_date, due_date, priority, prioritized, sort_order, color)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(task_type, title, description, tags, origin_date, sd, end_date, due_date, priority, prioritized ? 1 : 0, sort_order, color ?? null);

    const id = result.lastInsertRowid;

    // Insert first day entry on start_date
    ensureEntryForDate(id, sd);

    // For future tasks: pre-populate entries for the full range
    if (task_type === 'future' && end_date) {
      let cursor = addDays(sd, 1);
      while (cursor <= end_date) {
        ensureEntryForDate(id, cursor);
        cursor = addDays(cursor, 1);
      }
    }

    logAction('task.create', 'task', String(id), `Created task: "${title}" [${task_type}]`);
    return id;
  },

  /** Update task metadata fields */
  update(id, { title, description, tags, due_date, end_date, task_type, priority, prioritized, sort_order, color } = {}) {
    const fields = [];
    const values = [];
    if (title !== undefined) { fields.push('title = ?'); values.push(title); }
    if (description !== undefined) { fields.push('description = ?'); values.push(description); }
    if (tags !== undefined) { fields.push('tags = ?'); values.push(tags); }
    if (due_date !== undefined) { fields.push('due_date = ?'); values.push(due_date); }
    if (end_date !== undefined) { fields.push('end_date = ?'); values.push(end_date); }
    if (task_type !== undefined) { fields.push('task_type = ?'); values.push(task_type); }
    if (priority !== undefined) { fields.push('priority = ?'); values.push(priority); }
    if (prioritized !== undefined) { fields.push('prioritized = ?'); values.push(prioritized ? 1 : 0); }
    if (sort_order !== undefined) { fields.push('sort_order = ?'); values.push(sort_order); }
    if (color !== undefined) { fields.push('color = ?'); values.push(color); }
    if (fields.length === 0) return;
    fields.push("updated_at = datetime('now')");
    values.push(id);
    getDb().prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    logAction('task.update', 'task', String(id), `Updated task #${id}`);
  },

  /**
   * Persist manual order.
   * group='normal': write per-day order into task_day_entries.sort_order
   * group='rolled': write rolled-section order into tasks.priority
   */
  reorder(date, group, orderedIds = []) {
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) return;
    const db = getDb();

    if (group === 'rolled') {
      const updatePriority = db.prepare(`UPDATE tasks SET priority = ?, updated_at = datetime('now') WHERE id = ?`);
      const tx = db.transaction((ids) => {
        ids.forEach((id, idx) => updatePriority.run(idx + 1, id));
      });
      tx(orderedIds);
      logAction('task.reorder.rolled', 'task', String(orderedIds[0]), `Reordered ${orderedIds.length} rolled tasks`);
      return;
    }

    const updateEntryOrder = db.prepare(`
      UPDATE task_day_entries
      SET sort_order = ?, updated_at = datetime('now')
      WHERE task_id = ? AND entry_date = ?
    `);
    const tx = db.transaction((ids, entryDate) => {
      ids.forEach((id, idx) => updateEntryOrder.run(idx + 1, id, entryDate));
    });
    tx(orderedIds, date);
    logAction('task.reorder.day', 'task', String(orderedIds[0]), `Reordered ${orderedIds.length} tasks on ${date}`);
  },

  /**
   * Mark a task done (or un-done) — updates both tasks table and the entry for today's date.
   * @param {number} id         task id
   * @param {boolean} done
   * @param {string}  entryDate  the date being viewed when user toggled
   */
  setDone(id, done, entryDate) {
    const db = getDb();
    // Update master done flag
    db.prepare(`
      UPDATE tasks
      SET done = ?, done_at = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(done ? 1 : 0, done ? new Date().toISOString() : null, id);

    // Update the specific day entry status
    db.prepare(`
      UPDATE task_day_entries
      SET status = ?, updated_at = datetime('now')
      WHERE task_id = ? AND entry_date = ?
    `).run(done ? 'done' : 'pending', id, entryDate);

    logAction(done ? 'task.done' : 'task.undone', 'task', String(id),
      `Task #${id} marked ${done ? 'done' : 'pending'} on ${entryDate}`);
  },

  /** Soft delete */
  delete(id) {
    const t = getDb().prepare('SELECT title FROM tasks WHERE id = ?').get(id);
    getDb().prepare(`
      UPDATE tasks SET deleted = 1, deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?
    `).run(id);
    logAction('task.delete', 'task', String(id), `Deleted task: "${t?.title}"`);
  },

  /** Archive / unarchive */
  archive(id) {
    getDb().prepare(`
      UPDATE tasks SET archived = 1, archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?
    `).run(id);
    logAction('task.archive', 'task', String(id), `Archived task #${id}`);
  },
  unarchive(id) {
    getDb().prepare(`
      UPDATE tasks SET archived = 0, archived_at = NULL, updated_at = datetime('now') WHERE id = ?
    `).run(id);
    logAction('task.unarchive', 'task', String(id), `Unarchived task #${id}`);
  },

  /** Get archived tasks */
  getArchived() {
    return getDb().prepare(`
      SELECT * FROM tasks WHERE archived = 1 AND deleted = 0 ORDER BY archived_at DESC
    `).all();
  },

  /** FTS5 search across title + description + tags */
  search(query) {
    if (!query?.trim()) return [];
    const safe = query.trim().replace(/['"*^]/g, ' ').trim();
    if (!safe) return [];
    return getDb().prepare(`
      SELECT t.*
      FROM tasks t
      JOIN tasks_fts f ON f.rowid = t.id
      WHERE tasks_fts MATCH ?
        AND t.deleted = 0
      ORDER BY rank
    `).all(`${safe}*`);
  },

  /** Exact tag search */
  searchByTag(tag) {
    return getDb().prepare(`
      SELECT * FROM tasks
      WHERE ',' || tags || ',' LIKE '%,' || ? || ',%'
        AND deleted = 0 AND archived = 0
      ORDER BY start_date ASC, created_at ASC
    `).all(tag.trim());
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// ACTIONS
// ─────────────────────────────────────────────────────────────────────────────
export const actions = {
  getRecent(limit = 50) {
    return getDb().prepare('SELECT * FROM actions ORDER BY created_at DESC LIMIT ?').all(limit);
  },
  getByType(type, limit = 50) {
    return getDb().prepare('SELECT * FROM actions WHERE action_type = ? ORDER BY created_at DESC LIMIT ?').all(type, limit);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// LOGS
// ─────────────────────────────────────────────────────────────────────────────
export const logs = {
  write(level, category, message, detail = null) {
    getDb().prepare(`INSERT INTO logs (level, category, message, detail) VALUES (?,?,?,?)`)
      .run(level, category, message, detail ? JSON.stringify(detail) : null);
  },
  getRecent(limit = 100, level = null) {
    if (level) return getDb().prepare('SELECT * FROM logs WHERE level = ? ORDER BY created_at DESC LIMIT ?').all(level, limit);
    return getDb().prepare('SELECT * FROM logs ORDER BY created_at DESC LIMIT ?').all(limit);
  },
  info(c, m, d) { this.write('info', c, m, d); },
  warn(c, m, d) { this.write('warn', c, m, d); },
  error(c, m, d) { this.write('error', c, m, d); },
};
