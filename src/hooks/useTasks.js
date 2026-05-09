/**
 * useTasks(date)
 * Input:  ISO date string (YYYY-MM-DD)
 * Output: { tasks, createTask, setDone, deleteTask, editTask, reorderTask, reload }
 *
 * Automatically reloads whenever `date` changes.
 * Falls back to in-memory state when not running inside Electron.
 */
import { useState, useEffect, useCallback } from 'react';

// Evaluated lazily inside functions — never at module load time
function getIsElectron() {
  return typeof window !== 'undefined' && !!window.db;
}

let memoryId = 1;
const memoryTasksByDate = new Map();

function getMemoryTasksForDate(date) {
  return memoryTasksByDate.get(date) ?? [];
}

function setMemoryTasksForDate(date, rows) {
  memoryTasksByDate.set(date, rows);
}

/** Used by CalendarPage to build the grid map in non-Electron (browser) mode */
export function getMemoryGridTasks(cells) {
  const result = {};
  for (const { dateStr } of cells) {
    const rows = memoryTasksByDate.get(dateStr);
    if (rows && rows.length > 0) result[dateStr] = rows;
  }
  return result;
}

export function useTasks(date) {
  const [tasks, setTasks] = useState([]);

  // Re-fetch whenever date changes
  useEffect(() => {
    if (!date) return;
    const isElectron = getIsElectron();
    if (!isElectron) {
      setTasks(getMemoryTasksForDate(date));
      return;
    }

    setTasks([]);

    let cancelled = false;
    window.db.tasks
      .getByDate(date)
      .then((rows) => {
        if (cancelled) return;
        setTasks(rows ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[useTasks] getByDate failed:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  const reload = useCallback(
    async () => {
      if (!date) return;
      if (!getIsElectron()) {
        setTasks(getMemoryTasksForDate(date));
        return;
      }
      const rows = await window.db.tasks.getByDate(date);
      setTasks(rows ?? []);
    },
    [date]
  );

  /**
   * @param {object} p
   * @param {string} p.title
   * @param {string} [p.description]
   * @param {string} [p.tags]         comma-separated
   * @param {string} [p.task_type]    'regular'|'one_day'|'due_date'|'future'
   * @param {string} [p.start_date]
   * @param {string} [p.end_date]
   * @param {string} [p.due_date]
   */
  const createTask = useCallback(
    async ({ title, description = '', tags = '', task_type = 'regular', start_date, end_date, due_date, prioritized = 0 }) => {
      if (!title.trim()) return;
      if (getIsElectron()) {
        await window.db.tasks.create({
          origin_date: date,
          title: title.trim(),
          description: description.trim(),
          tags: tags.trim(),
          task_type,
          start_date: start_date || date,
          end_date: end_date || null,
          due_date: due_date || null,
          prioritized,
        });
        await reload();
      } else {
        const prevRows = getMemoryTasksForDate(date);
        const nextRows = [
          ...prevRows,
          {
            id: memoryId++,
            entry_id: memoryId++,
            task_type,
            title: title.trim(),
            description: description.trim(),
            tags: tags.trim(),
            origin_date: date,
            start_date: start_date || date,
            end_date: end_date || null,
            due_date: due_date || null,
            done: 0,
            entry_status: 'pending',
            entry_date: date,
            archived: 0,
            deleted: 0,
            priority: 0,
            prioritized,
            sort_order: prevRows.length + 1,
          },
        ];
        setMemoryTasksForDate(date, nextRows);
        setTasks(nextRows);
      }
    },
    [date, reload]
  );

  /**
   * Toggle done on a specific task for the current date entry.
   * @param {object} task  — the full task row (must have .id, .done, .entry_date)
   */
  const setDone = useCallback(
    async (task) => {
      const newDone = !task.done;
      if (getIsElectron()) {
        await window.db.tasks.setDone(task.id, newDone, task.entry_date || date);
        await reload();
      } else {
        const nextRows = getMemoryTasksForDate(date).map((t) => (t.id === task.id ? { ...t, done: newDone ? 1 : 0, entry_status: newDone ? 'done' : 'pending' } : t));
        setMemoryTasksForDate(date, nextRows);
        setTasks(nextRows);
      }
    },
    [date, reload]
  );

  /** Soft-delete a task */
  const deleteTask = useCallback(
    async (id) => {
      if (getIsElectron()) {
        await window.db.tasks.delete(id);
        await reload();
      } else {
        const nextRows = getMemoryTasksForDate(date).filter((t) => t.id !== id);
        setMemoryTasksForDate(date, nextRows);
        setTasks(nextRows);
      }
    },
    [date, reload]
  );

  /** Edit task metadata */
  const editTask = useCallback(
    async (id, fields) => {
      if (getIsElectron()) {
        await window.db.tasks.update(id, fields);
        await reload();
      } else {
        const nextRows = getMemoryTasksForDate(date).map((t) => (t.id === id ? { ...t, ...fields } : t));
        setMemoryTasksForDate(date, nextRows);
        setTasks(nextRows);
      }
    },
    [date, reload]
  );

  /** Update only the color field — optimistic, no full reload */
  const updateColor = useCallback(
    async (id, color) => {
      // Optimistic update first
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, color } : t)));
      const nextRows = getMemoryTasksForDate(date).map((t) => (t.id === id ? { ...t, color } : t));
      setMemoryTasksForDate(date, nextRows);
      if (getIsElectron()) {
        await window.db.tasks.update(id, { color });
      }
    },
    [date]
  );

  /** Toggle prioritized field — optimistic, no full reload */
  const togglePrioritized = useCallback(
    async (task) => {
      const nextPrioritized = task.prioritized === 1 ? 0 : 1;

      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, prioritized: nextPrioritized } : t)));

      const nextRows = getMemoryTasksForDate(date).map((t) =>
        t.id === task.id ? { ...t, prioritized: nextPrioritized } : t
      );
      setMemoryTasksForDate(date, nextRows);

      if (getIsElectron()) {
        await window.db.tasks.update(task.id, { prioritized: nextPrioritized });
      }
    },
    [date]
  );

  /**
   * Reorder tasks via drag-and-drop.
   * Accepts a reordered list for one group only:
   * - group='normal' => current date tasks
   * - group='rolled' => today's rolled tasks (display-only group)
   */
  const reorderTask = useCallback(async (orderedGroup, group = 'normal') => {
    if (!Array.isArray(orderedGroup) || orderedGroup.length === 0) return;

    const orderMap = new Map(orderedGroup.map((t, idx) => [t.id, idx + 1]));
    setTasks((prev) => prev.map((t) => (orderMap.has(t.id) ? { ...t, sort_order: orderMap.get(t.id) } : t)));

    if (!getIsElectron()) {
      const nextRows = getMemoryTasksForDate(date).map((t) => (orderMap.has(t.id) ? { ...t, sort_order: orderMap.get(t.id) } : t));
      setMemoryTasksForDate(date, nextRows);
      return;
    }

    await window.db.tasks.reorder(date, group, orderedGroup.map((t) => t.id));
  }, [date]);

  return { tasks, createTask, setDone, deleteTask, editTask, updateColor, togglePrioritized, reorderTask, reload };
}
