import Database from 'better-sqlite3';
import {app} from 'electron';
import path from 'path';

// ---------------------------------------------------------------------------
// DB location: <userData>/todo-calendar.db
// ---------------------------------------------------------------------------
let db;

export function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

// ---------------------------------------------------------------------------
// Initialize — called once from main.js at startup
// ---------------------------------------------------------------------------
export function initDb() {
  const dbPath = path.join(app.getPath('userData'), 'todo-calendar.db');
  db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  createTables();
  migrateTables();
  scheduleCleanup();

  console.log(`[DB] Initialized at: ${dbPath}`);
  return db;
}

// ---------------------------------------------------------------------------
// Table creation
// ---------------------------------------------------------------------------
function createTables() {
  db.exec(`
    -- -------------------------------------------------------------------------
    -- 1. CONFIG
    -- -------------------------------------------------------------------------
    CREATE TABLE IF NOT EXISTS config (
      key        TEXT PRIMARY KEY NOT NULL,
      value      TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- -------------------------------------------------------------------------
    -- 2. TASKS  (source of truth for every task)
    --
    --   task_type:
    --     'regular'   — rolls to next day until done
    --     'one_day'   — only shown on origin_date; becomes overdue if missed
    --     'due_date'  — rolls daily until due_date; then overdue
    --     'future'    — visible only between start_date and end_date
    --
    --   Lifecycle flags:
    --     done / done_at    — master completion
    --     archived          — hidden from normal views, kept in archive
    --     deleted           — soft-deleted, excluded from all views
    -- -------------------------------------------------------------------------
    CREATE TABLE IF NOT EXISTS tasks (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      task_type    TEXT    NOT NULL DEFAULT 'regular',
      title        TEXT    NOT NULL,
      description  TEXT    NOT NULL DEFAULT '',
      tags         TEXT    NOT NULL DEFAULT '',
      origin_date  TEXT    NOT NULL,          -- date the task was created on
      start_date   TEXT    NOT NULL,          -- first day it appears
      end_date     TEXT,                      -- last day (future tasks)
      due_date     TEXT,                      -- hard deadline (due_date tasks)
      done         INTEGER NOT NULL DEFAULT 0,
      done_at      TEXT    DEFAULT NULL,
      archived     INTEGER NOT NULL DEFAULT 0,
      archived_at  TEXT    DEFAULT NULL,
      deleted      INTEGER NOT NULL DEFAULT 0,
      deleted_at   TEXT    DEFAULT NULL,
      -- Reserved fields for future use
      c_date       TEXT    DEFAULT NULL,
      c_config     TEXT    DEFAULT NULL,
      c_action     TEXT    DEFAULT NULL,
      c_additional TEXT    DEFAULT NULL,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_start_date  ON tasks(start_date);
    CREATE INDEX IF NOT EXISTS idx_tasks_end_date    ON tasks(end_date);
    CREATE INDEX IF NOT EXISTS idx_tasks_due_date    ON tasks(due_date);
    CREATE INDEX IF NOT EXISTS idx_tasks_done        ON tasks(done);
    CREATE INDEX IF NOT EXISTS idx_tasks_archived    ON tasks(archived);
    CREATE INDEX IF NOT EXISTS idx_tasks_deleted     ON tasks(deleted);

    -- -------------------------------------------------------------------------
    -- 2a. FTS5 — full-text search on title + description + tags
    -- -------------------------------------------------------------------------
    CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(
      title,
      description,
      tags,
      content=tasks,
      content_rowid=id,
      tokenize='unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS tasks_ai AFTER INSERT ON tasks BEGIN
      INSERT INTO tasks_fts(rowid, title, description, tags)
        VALUES (new.id, new.title, new.description, new.tags);
    END;
    CREATE TRIGGER IF NOT EXISTS tasks_ad AFTER DELETE ON tasks BEGIN
      INSERT INTO tasks_fts(tasks_fts, rowid, title, description, tags)
        VALUES ('delete', old.id, old.title, old.description, old.tags);
    END;
    CREATE TRIGGER IF NOT EXISTS tasks_au AFTER UPDATE ON tasks BEGIN
      INSERT INTO tasks_fts(tasks_fts, rowid, title, description, tags)
        VALUES ('delete', old.id, old.title, old.description, old.tags);
      INSERT INTO tasks_fts(rowid, title, description, tags)
        VALUES (new.id, new.title, new.description, new.tags);
    END;

    -- -------------------------------------------------------------------------
    -- 3. TASK_DAY_ENTRIES  (display ledger — one row per task×date)
    --
    --   status:
    --     'pending'  — not yet done on this day
    --     'done'     — completed on this specific day
    --     'rolled'   — carried forward to the next day (task was pending)
    --     'overdue'  — past due_date or past one_day date, not completed
    --     'skipped'  — user explicitly skipped this day
    -- -------------------------------------------------------------------------
    CREATE TABLE IF NOT EXISTS task_day_entries (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      entry_date TEXT    NOT NULL,
      status     TEXT    NOT NULL DEFAULT 'pending',
      note       TEXT    DEFAULT NULL,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(task_id, entry_date)
    );

    CREATE INDEX IF NOT EXISTS idx_tde_entry_date ON task_day_entries(entry_date);
    CREATE INDEX IF NOT EXISTS idx_tde_task_id    ON task_day_entries(task_id);
    CREATE INDEX IF NOT EXISTS idx_tde_status     ON task_day_entries(status);

    -- -------------------------------------------------------------------------
    -- 4. ACTIONS  (purged after 7 days)
    -- -------------------------------------------------------------------------
    CREATE TABLE IF NOT EXISTS actions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      action_type TEXT    NOT NULL,
      entity_type TEXT,
      entity_id   TEXT,
      description TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_actions_created_at ON actions(created_at);

    -- -------------------------------------------------------------------------
    -- 5. LOGS  (purged after 30 days)
    -- -------------------------------------------------------------------------
    CREATE TABLE IF NOT EXISTS logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      level      TEXT    NOT NULL DEFAULT 'info',
      category   TEXT    NOT NULL DEFAULT 'app',
      message    TEXT    NOT NULL,
      detail     TEXT,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_logs_level      ON logs(level);
  `);
}

// ---------------------------------------------------------------------------
// Migrations — add columns to existing tables without breaking existing data
// ---------------------------------------------------------------------------
function migrateTables() {
  const cols = db
    .prepare(`PRAGMA table_info(tasks)`)
    .all()
    .map((c) => c.name);
  if (!cols.includes('priority')) {
    db.exec(`ALTER TABLE tasks
        ADD COLUMN priority INTEGER NOT NULL DEFAULT 0`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority)`);
    console.log('[DB] Migration: added priority column to tasks');
  }
  if (!cols.includes('prioritized')) {
    db.exec(`ALTER TABLE tasks
        ADD COLUMN prioritized INTEGER NOT NULL DEFAULT 0`);
    console.log('[DB] Migration: added prioritized column to tasks');
  }
  if (!cols.includes('sort_order')) {
    db.exec(`ALTER TABLE tasks
        ADD COLUMN sort_order REAL NOT NULL DEFAULT 0`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_sort_order ON tasks(sort_order)`);
    console.log('[DB] Migration: added sort_order column to tasks');
  }
  if (!cols.includes('color')) {
    db.exec(`ALTER TABLE tasks
        ADD COLUMN color TEXT DEFAULT NULL`);
    console.log('[DB] Migration: added color column to tasks');
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
function purgeOldData() {
  const a = db.prepare(`DELETE
                        FROM actions
                        WHERE created_at < datetime('now', '-7 days')`).run();
  const l = db.prepare(`DELETE
                        FROM logs
                        WHERE created_at < datetime('now', '-30 days')`).run();
  if (a.changes > 0 || l.changes > 0) console.log(`[DB] Purged ${a.changes} old actions, ${l.changes} old logs`);
}

function scheduleCleanup() {
  purgeOldData();
  setInterval(purgeOldData, 6 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Close DB gracefully on app quit
// ---------------------------------------------------------------------------
export function closeDb() {
  if (db) {
    db.close();
    db = null;
    console.log('[DB] Closed.');
  }
}
