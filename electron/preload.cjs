// Preload: runs in a privileged context before the renderer page.
// Use contextBridge to safely expose APIs to the React app.
const { contextBridge, ipcRenderer } = require('electron');

// Expose a clean API to the renderer — no Node.js access, only named channels
contextBridge.exposeInMainWorld('db', {
  // Tasks
  tasks: {
    getByDate: (date) => ipcRenderer.invoke('tasks:getByDate', date),
    getMonthCounts: (yearMonth) => ipcRenderer.invoke('tasks:getMonthCounts', yearMonth),
    getGridTasks: (startDate, endDate) => ipcRenderer.invoke('tasks:getGridTasks', startDate, endDate),
    getById: (id) => ipcRenderer.invoke('tasks:getById', id),
    create: (data) => ipcRenderer.invoke('tasks:create', data),
    update: (id, data) => ipcRenderer.invoke('tasks:update', id, data),
    reorder: (date, group, orderedIds) => ipcRenderer.invoke('tasks:reorder', date, group, orderedIds),
    setDone: (id, done, entryDate) => ipcRenderer.invoke('tasks:setDone', id, done, entryDate),
    delete: (id) => ipcRenderer.invoke('tasks:delete', id),
    archive: (id) => ipcRenderer.invoke('tasks:archive', id),
    unarchive: (id) => ipcRenderer.invoke('tasks:unarchive', id),
    getArchived: () => ipcRenderer.invoke('tasks:getArchived'),
    search: (query) => ipcRenderer.invoke('tasks:search', query),
    searchByTag: (tag) => ipcRenderer.invoke('tasks:searchByTag', tag),
  },

  // Config
  config: {
    get: (key) => ipcRenderer.invoke('config:get', key),
    set: (key, value) => ipcRenderer.invoke('config:set', key, value),
    getAll: () => ipcRenderer.invoke('config:getAll'),
    delete: (key) => ipcRenderer.invoke('config:delete', key),
  },

  // Actions
  actions: {
    getRecent: (limit) => ipcRenderer.invoke('actions:getRecent', limit),
    getByType: (type, limit) => ipcRenderer.invoke('actions:getByType', type, limit),
  },

  // Logs
  logs: {
    getRecent: (limit, level) => ipcRenderer.invoke('logs:getRecent', limit, level),
    write: (level, cat, msg, detail) => ipcRenderer.invoke('logs:write', level, cat, msg, detail),
    info: (cat, msg, detail) => ipcRenderer.invoke('logs:write', 'info', cat, msg, detail),
    warn: (cat, msg, detail) => ipcRenderer.invoke('logs:write', 'warn', cat, msg, detail),
    error: (cat, msg, detail) => ipcRenderer.invoke('logs:write', 'error', cat, msg, detail),
  },

  // AI
  ai: {
    chatOpenAI: (payload) => ipcRenderer.invoke('ai:chatOpenAI', payload),
  },
});
