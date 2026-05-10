const MAX_CONTEXT_TASKS = 12;

function trimText(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function summarizeTask(task, index) {
  const title = trimText(task?.title) || `Task ${index + 1}`;
  const status = task?.done === 1 || task?.entry_status === 'done' ? 'done' : 'pending';
  const rolled = task?.entry_status === 'rolled' ? 'rolled' : null;
  const flags = [status, rolled].filter(Boolean).join(', ');
  return `${index + 1}. ${title} (${flags})`;
}

function buildTaskContext(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) return 'No tasks in current view.';
  return tasks.slice(0, MAX_CONTEXT_TASKS).map(summarizeTask).join('\n');
}

export function buildSystemPrompt({ selectedDate, tasks }) {
  const dateText = trimText(selectedDate) || 'unknown date';
  const taskContext = buildTaskContext(tasks);
  return [
    "You are Todo Calendar Assistant.",
    "Reply in the user's language.",
    "Give concise, practical, actionable advice (max 5 bullets).",
    "If the question is about tasks/planning/priorities, use only the task context and selected date below.",
    "If required task info is missing, say so briefly and ask one clarifying question.",
    "If the question is not task-related, ignore task context and selected date.",
    `Selected date: ${dateText}`,
    "Task context:",
    taskContext,
  ].join("\n");
}

