import {
  buildActionJsonContract,
  buildProcessorInstructionTable,
} from './actionCatalog.js';

const MAX_CONTEXT_TASKS = 12;
const MAX_RESULT_CHARS = 8000;

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

function serializeExecutionResults(executionResults) {
  if (typeof executionResults === 'string') {
    const text = executionResults.trim();
    if (!text) return 'No processor execution result provided.';
    return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n...<truncated>` : text;
  }

  if (executionResults === null || executionResults === undefined) {
    return 'No processor execution result provided.';
  }

  try {
    const text = JSON.stringify(executionResults, null, 2);
    return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n...<truncated>` : text;
  } catch {
    return String(executionResults);
  }
}

/**
 * Existing direct-chat system prompt used by current chat path.
 * This remains available so current UI behavior does not break.
 */
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

/**
 * First-stage action prompt:
 * - includes full processor instruction table (read + write)
 * - includes user query and visible task snapshot
 * - expects compact JSON response with type/actions
 */
export function buildFirstActionPrompt({
  selectedDate,
  tasks,
  userQuery,
}) {
  const dateText = trimText(selectedDate) || 'unknown date';
  const queryText = trimText(userQuery) || 'No explicit user query provided.';
  const taskContext = buildTaskContext(tasks);

  return [
    'You are Todo Calendar Action Planner.',
    "Reply in the user's language only when needed in JSON string values.",
    'Your output must be JSON only.',
    'Determine whether the request needs noAction, read, or write.',
    'Never output markdown or explanations outside JSON.',
    '',
    `Selected date: ${dateText}`,
    `User query: ${queryText}`,
    'Visible task context:',
    taskContext,
    '',
    'Available processor instructions:',
    buildProcessorInstructionTable({ includeRead: true, includeWrite: true }),
    '',
    buildActionJsonContract({ allowRead: true }),
  ].join('\n');
}

/**
 * Second-stage action prompt:
 * - includes processor execution results from stage 1
 * - includes write instruction table (and optional read table)
 * - expects compact JSON response with type noAction/write by default
 */
export function buildSecondActionPrompt({
  selectedDate,
  tasks,
  userQuery,
  processorExecutionResults,
  includeReadInstructions = false,
}) {
  const dateText = trimText(selectedDate) || 'unknown date';
  const queryText = trimText(userQuery) || 'No explicit user query provided.';
  const taskContext = buildTaskContext(tasks);
  const resultText = serializeExecutionResults(processorExecutionResults);

  return [
    'You are Todo Calendar Action Planner.',
    "Reply in the user's language only when needed in JSON string values.",
    'Your output must be JSON only.',
    'Use processor execution results to decide final action.',
    'In this stage, prefer noAction or write.',
    'Never output markdown or explanations outside JSON.',
    '',
    `Selected date: ${dateText}`,
    `User query: ${queryText}`,
    'Visible task context:',
    taskContext,
    '',
    'Processor execution results:',
    resultText,
    '',
    'Available processor instructions:',
    buildProcessorInstructionTable({
      includeRead: includeReadInstructions,
      includeWrite: true,
    }),
    '',
    buildActionJsonContract({ allowRead: includeReadInstructions }),
  ].join('\n');
}

