/**
 * useTodos(date)
 *
 * Custom hook — input: ISO date string (YYYY-MM-DD)
 *               output: { todos, loading, addTodo, toggleDone, deleteTodo, reload }
 *
 * Automatically reloads whenever `date` changes.
 * Falls back to in-memory state when not running inside Electron.
 */
import { useState, useEffect, useCallback } from 'react';

const isElectron = () => typeof window !== 'undefined' && !!window.db;

export function useTodos(date) {
  const [todos, setTodos] = useState([]);
  const [loading, setLoading] = useState(false);

  // ── Load todos for the given date ────────────────────────────────────────
  const reload = useCallback(async () => {
    if (!date) return;
    setLoading(true);
    if (isElectron()) {
      const rows = await window.db.todos.getByDate(date);
      setTodos(rows);
    }
    setLoading(false);
  }, [date]);

  useEffect(() => {
    reload();
  }, [reload]);

  // ── CRUD operations ───────────────────────────────────────────────────────
  /**
   * @param {object} params
   * @param {string} params.title
   * @param {string} [params.description]
   * @param {string} [params.date_start]  YYYY-MM-DD, defaults to the anchor date
   * @param {string} [params.date_end]    YYYY-MM-DD
   * @param {string} [params.tags]        comma-separated, e.g. "work,urgent"
   */
  const addTodo = useCallback(
    async ({ title, description = '', date_start = null, date_end = null, tags = '' }) => {
      if (!title.trim()) return;
      if (isElectron()) {
        await window.db.todos.create({
          date,
          title:       title.trim(),
          description: description.trim(),
          date_start:  date_start || null,
          date_end:    date_end   || null,
          tags:        tags.trim(),
        });
        await reload();
      } else {
        setTodos((prev) => [
          ...prev,
          {
            id: Date.now(), date,
            title: title.trim(), description: description.trim(),
            date_start: date_start || null, date_end: date_end || null,
            tags: tags.trim(), done: 0,
            c_date: null, c_config: null, c_action: null, c_additional: null,
          },
        ]);
      }
    },
    [date, reload]
  );

  const toggleDone = useCallback(
    async (todo) => {
      if (isElectron()) {
        await window.db.todos.update(todo.id, { done: !todo.done });
        await reload();
      } else {
        setTodos((prev) => prev.map((t) => (t.id === todo.id ? { ...t, done: t.done ? 0 : 1 } : t)));
      }
    },
    [reload]
  );

  const deleteTodo = useCallback(
    async (id) => {
      if (isElectron()) {
        await window.db.todos.delete(id);
        await reload();
      } else {
        setTodos((prev) => prev.filter((t) => t.id !== id));
      }
    },
    [reload]
  );

  return { todos, loading, addTodo, toggleDone, deleteTodo, reload };
}
