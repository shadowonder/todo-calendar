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

/** Add days to a YYYY-MM-DD string, returns YYYY-MM-DD */
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Today as YYYY-MM-DD */
function today() {
  return new Date().toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// ROLLOVER ENGINE  (Approach A — lazy, called before any date query)
//
// For every active (!done, !archived, !deleted) task that should appear on
// `date`, ensure a task_day_entry row exists. Mark previous pending entries
// as 'rolled'. Mark overdue tasks accordingly.
// ─────────────────────────────────────────────────────────────────────────────
function ensureEntriesForDate(date) {
  const db = getDb();

  // All active tasks whose window includes `date`
  const candidates = db.prepare(`
    SELECT * FROM tasks
    WHERE deleted = 0
      AND archived = 0
      AND done = 0
      AND (
        (task_type = 'regular'  AND start_date <= ?)
     OR (task_type = 'one_day'  AND start_date = ?)
     OR (task_type = 'due_date' AND start_date <= ? AND (due_date IS NULL OR due_date >= ?))
     OR (task_type = 'future'   AND start_date <= ? AND end_date >= ?)
      )
  `).all(date, date, date, date, date, date);

  const insertEntry = db.prepare(`
    INSERT OR IGNORE INTO task_day_entries (task_id, entry_date, status)
    VALUES (?, ?, 'pending')
  `);

  const markRolled = db.prepare(`
    UPDATE task_day_entries
    SET status = 'rolled', updated_at = datetime('now')
    WHERE task_id = ? AND entry_date < ? AND status = 'pending'
  `);

  const markOverdue = db.prepare(`
    UPDATE task_day_entries
    SET status = 'overdue', updated_at = datetime('now')
    WHERE task_id = ? AND status = 'pending'
  `);

  for (const task of candidates) {
    if (task.task_type === 'one_day') {
      if (date === task.start_date) {
        insertEntry.run(task.id, date);
      } else if (date > task.start_date) {
        markOverdue.run(task.id);
      }
    } else if (task.task_type === 'due_date' && task.due_date && date > task.due_date) {
      markOverdue.run(task.id);
    } else {
      // regular / due_date (within window) / future — decrement priority on each rollover
      const prevEntry = db.prepare(
        `SELECT id FROM task_day_entries WHERE task_id = ? AND entry_date < ? AND status = 'pending' LIMIT 1`
      ).get(task.id, date);
      if (prevEntry) {
        // Task is rolling over to a new day — decrement priority (lower = older = sorts higher)
        db.prepare(`UPDATE tasks SET priority = priority - 1, updated_at = datetime('now') WHERE id = ?`).run(task.id);
      }
      markRolled.run(task.id, date);
      insertEntry.run(task.id, date);
    }
  }
}

// Also handle overdue entries for tasks whose due_date has passed
function ensureOverdueForDate(date) {
  getDb().prepare(`
    UPDATE task_day_entries
    SET status = 'overdue', updated_at = datetime('now')
    WHERE status = 'pending'
      AND task_id IN (
        SELECT id FROM tasks
        WHERE task_type = 'due_date' AND due_date < ? AND done = 0
        UNION
        SELECT id FROM tasks
        WHERE task_type = 'one_day' AND start_date < ? AND done = 0
      )
  `).run(date, date);
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
   * Runs lazy rollover before querying — ensures entries exist.
   */
  getByDate(date) {
    ensureEntriesForDate(date);
    ensureOverdueForDate(date);
    return getDb().prepare(`
      SELECT t.*, e.id AS entry_id, e.status AS entry_status, e.note AS entry_note, e.entry_date
      FROM task_day_entries e
      JOIN tasks t ON t.id = e.task_id
      WHERE e.entry_date = ?
        AND t.deleted   = 0
        AND t.archived  = 0
      ORDER BY e.created_at ASC
    `).all(date);
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
    const end = new Date(y, m, 0).toISOString().slice(0, 10);

    // Ensure entries exist for every day in the month up to today
    const todayStr = today();
    let cursor = start;
    while (cursor <= end && cursor <= todayStr) {
      ensureEntriesForDate(cursor);
      cursor = addDays(cursor, 1);
    }
    ensureOverdueForDate(todayStr);

    const rows = getDb().prepare(`
      SELECT e.entry_date, COUNT(*) AS count
      FROM task_day_entries e
      JOIN tasks t ON t.id = e.task_id
      WHERE e.entry_date >= ? AND e.entry_date <= ?
        AND e.status IN ('pending', 'overdue')
        AND t.deleted  = 0
        AND t.archived = 0
      GROUP BY e.entry_date
    `).all(start, end);

    const result = {};
    for (const row of rows) result[row.entry_date] = row.count;
    return result;
  },

  /**
   * Get all tasks for a date range (used to populate the full calendar grid,
   * including overflow days from prev/next month).
   * Returns: { 'YYYY-MM-DD': [ { id, title, entry_status, done, prioritized, ... }, ... ], ... }
   * @param {string} startDate  first cell date, e.g. '2026-04-27'
   * @param {string} endDate    last  cell date, e.g. '2026-06-07'
   */
  getGridTasks(startDate, endDate) {
    // Run rollover for every day in the range up to today so entries exist
    const todayStr = today();
    let cursor = startDate;
    while (cursor <= endDate && cursor <= todayStr) {
      ensureEntriesForDate(cursor);
      cursor = addDays(cursor, 1);
    }
    ensureOverdueForDate(todayStr);

    const rows = getDb().prepare(`
      SELECT t.id, t.title, t.prioritized, t.done, t.task_type, t.color,
             t.sort_order, t.priority,
             e.entry_date, e.status AS entry_status
      FROM task_day_entries e
      JOIN tasks t ON t.id = e.task_id
      WHERE e.entry_date >= ? AND e.entry_date <= ?
        AND t.deleted  = 0
        AND t.archived = 0
      ORDER BY e.entry_date ASC, t.prioritized DESC, t.sort_order ASC, t.priority ASC, t.id ASC
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

    // Compute next sort_order for this day (max existing + 1.0)
    const maxRow = getDb().prepare(`
      SELECT MAX(sort_order) AS m FROM tasks
      WHERE start_date = ? AND deleted = 0
    `).get(sd);
    const sort_order = (maxRow?.m ?? 0) + 1.0;

    const result = getDb().prepare(`
      INSERT INTO tasks (task_type, title, description, tags, origin_date, start_date, end_date, due_date, priority, prioritized, sort_order, color)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(task_type, title, description, tags, origin_date, sd, end_date, due_date, prioritized ? 1 : 0, sort_order, color ?? null);

    const id = result.lastInsertRowid;

    // Insert first day entry on origin_date
    getDb().prepare(`
      INSERT OR IGNORE INTO task_day_entries (task_id, entry_date, status) VALUES (?, ?, 'pending')
    `).run(id, origin_date);

    // For future tasks: pre-populate entries for the full range
    if (task_type === 'future' && end_date) {
      let cursor = addDays(sd, 1);
      while (cursor <= end_date) {
        getDb().prepare(`INSERT OR IGNORE INTO task_day_entries (task_id, entry_date, status) VALUES (?, ?, 'pending')`).run(id, cursor);
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
    if (title        !== undefined) { fields.push('title = ?');        values.push(title); }
    if (description  !== undefined) { fields.push('description = ?');  values.push(description); }
    if (tags         !== undefined) { fields.push('tags = ?');         values.push(tags); }
    if (due_date     !== undefined) { fields.push('due_date = ?');     values.push(due_date); }
    if (end_date     !== undefined) { fields.push('end_date = ?');     values.push(end_date); }
    if (task_type    !== undefined) { fields.push('task_type = ?');    values.push(task_type); }
    if (priority     !== undefined) { fields.push('priority = ?');     values.push(priority); }
    if (prioritized  !== undefined) { fields.push('prioritized = ?');  values.push(prioritized ? 1 : 0); }
    if (sort_order   !== undefined) { fields.push('sort_order = ?');   values.push(sort_order); }
    if (color        !== undefined) { fields.push('color = ?');        values.push(color); }
    if (fields.length === 0) return;
    fields.push("updated_at = datetime('now')");
    values.push(id);
    getDb().prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    logAction('task.update', 'task', String(id), `Updated task #${id}`);
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
  info(c, m, d)  { this.write('info',  c, m, d); },
  warn(c, m, d)  { this.write('warn',  c, m, d); },
  error(c, m, d) { this.write('error', c, m, d); },
};
