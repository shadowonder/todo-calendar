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
    'You are Todo Calendar Assistant.',
    "Reply in the user's language.",
    'Output final answer only. Never output chain-of-thought, hidden reasoning, or <think> tags.',
    'You only help with todo tasks, calendar planning, prioritization, and scheduling.',
    'Use only the selected date and task context below for factual claims.',
    'Never use external facts (news, web, weather, current events, world knowledge).',
    'If off-topic or too vague, ask one short clarifying task question.',
    'Keep it concise and practical (max 5 bullets or 4 short sentences).',
    `Selected date: ${dateText}`,
    'Task context:',
    taskContext,
  ].join('\n');
}
