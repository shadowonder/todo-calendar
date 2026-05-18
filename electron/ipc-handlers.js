/**
 * ipc-handlers.js
 * Registers all IPC handlers between main process (DB) and renderer (React).
 * All DB calls live here — the renderer never touches SQLite directly.
 */
import { ipcMain } from 'electron';
import { tasks, config, actions, logs } from './db-service.js';
import { chatOpenAI, requestRestAuth } from './ai-service.js';

export function registerIpcHandlers() {
  // -----------------------------------------------------------------------
  // TASKS
  // -----------------------------------------------------------------------
  ipcMain.handle('tasks:getByDate',     (_, date)              => tasks.getByDate(date));
  ipcMain.handle('tasks:getMonthCounts',(_, yearMonth)         => tasks.getMonthCounts(yearMonth));
  ipcMain.handle('tasks:getGridTasks',  (_, startDate, endDate)=> tasks.getGridTasks(startDate, endDate));
  ipcMain.handle('tasks:getById',       (_, id)                => tasks.getById(id));
  ipcMain.handle('tasks:create',        (_, data)       => tasks.create(data));
  ipcMain.handle('tasks:update',        (_, id, data)   => tasks.update(id, data));
  ipcMain.handle('tasks:reorder',       (_, date, group, orderedIds) => tasks.reorder(date, group, orderedIds));
  ipcMain.handle('tasks:setDone',       (_, id, done, entryDate) => tasks.setDone(id, done, entryDate));
  ipcMain.handle('tasks:delete',        (_, id)         => tasks.delete(id));
  ipcMain.handle('tasks:archive',       (_, id)         => tasks.archive(id));
  ipcMain.handle('tasks:unarchive',     (_, id)         => tasks.unarchive(id));
  ipcMain.handle('tasks:getArchived',   ()              => tasks.getArchived());
  ipcMain.handle('tasks:search',        (_, query)      => tasks.search(query));
  ipcMain.handle('tasks:searchByTag',   (_, tag)        => tasks.searchByTag(tag));

  // -----------------------------------------------------------------------
  // CONFIG
  // -----------------------------------------------------------------------
  ipcMain.handle('config:get',    (_, key)        => config.get(key));
  ipcMain.handle('config:set',    (_, key, value) => config.set(key, value));
  ipcMain.handle('config:getAll', ()              => config.getAll());
  ipcMain.handle('config:delete', (_, key)        => config.delete(key));

  // -----------------------------------------------------------------------
  // ACTIONS (read-only from renderer)
  // -----------------------------------------------------------------------
  ipcMain.handle('actions:getRecent', (_, limit)        => actions.getRecent(limit));
  ipcMain.handle('actions:getByType', (_, type, limit)  => actions.getByType(type, limit));

  // -----------------------------------------------------------------------
  // LOGS (read-only from renderer, write via main process internally)
  // -----------------------------------------------------------------------
  ipcMain.handle('logs:getRecent', (_, limit, level)               => logs.getRecent(limit, level));
  ipcMain.handle('logs:write',     (_, level, category, msg, detail) => logs.write(level, category, msg, detail));

  // -----------------------------------------------------------------------
  // AI (remote request via main process to avoid renderer CORS limits)
  // -----------------------------------------------------------------------
  ipcMain.handle('ai:chatOpenAI', (_, payload) => chatOpenAI(payload));
  ipcMain.handle('ai:requestRestAuth', (_, payload) => requestRestAuth(payload));
}
