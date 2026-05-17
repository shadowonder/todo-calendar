/**
 * AI Layer: prompt resources
 *
 * Responsibilities:
 * - define reusable prompt builders
 * - keep system prompt structure centralized and minimal
 *
 * Non-responsibilities:
 * - do not call model providers
 * - do not validate model outputs
 * - do not execute actions or touch database/UI
 */
import {
  buildActionJsonContract,
  buildProcessorInstructionTable,
} from '../actions/actionCatalog.js';

const MAX_CONTEXT_TASKS = 12;

function trimText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function formatDateLabel(value) {
  const raw = trimText(value);
  if (!raw) return 'Unknown Date';

  const guess = raw.length === 10 ? `${raw}T00:00:00` : raw;
  const date = new Date(guess);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(date);
}

function summarizeTask(task, index) {
  const dateLabel = formatDateLabel(task?.entry_date || task?.start_date || task?.origin_date);
  const priorityLabel = task?.prioritized === 1 || task?.prioritized === true ? 'Prioritized' : 'Normal';
  const title = trimText(task?.title) || `Task ${index + 1}`;
  const description = trimText(task?.description) || '(empty)';
  const status = task?.done === 1 || task?.entry_status === 'done' ? 'done' : 'pending';
  const rolled = task?.entry_status === 'rolled' ? 'rolled' : null;
  const flags = [status, rolled].filter(Boolean).join(', ');
  return `${dateLabel} - ${priorityLabel} - ${title} - status: ${flags} - description: ${description}`;
}

function buildTaskContext(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) return 'No tasks in current view.';
  return tasks.slice(0, MAX_CONTEXT_TASKS).map(summarizeTask).join('\n');
}

function buildRuntimeContext({
  selectedDate,
  currentTime,
  timezone,
  tasks,
} = {}) {
  const dateText = trimText(selectedDate) || 'unknown date';
  const nowText = trimText(currentTime) || new Date().toISOString();
  const tzText = trimText(timezone) || 'UTC';
  const taskContext = buildTaskContext(tasks);

  return [
    'RUNTIME_CONTEXT',
    `selectedDate: ${dateText}`,
    `currentTime: ${nowText}`,
    `timezone: ${tzText}`,
    'visibleTasks:',
    taskContext,
  ].join('\n');
}

function buildJsonOutputHardRules() {
  return [
    'OUTPUT_RULES',
    '- Output exactly one JSON object. No markdown, no code fence, no extra prose.',
    '- Top-level keys must be exactly: action, response, actions.',
    '- action must be one of: noAction, read, write.',
    '- actions items must include: reason, method, args.',
    '- method must be a valid processor name and cannot be null.',
    '- args must be an array of positional values only.',
    '- Do not output key-value pair tuples like [["key","value"]].',
    '- response must be plain text. Do not place a JSON string inside response.',
  ].join('\n');
}

function buildLlmUserVisibleRules() {
  return [
    'USER_VISIBLE_RESPONSE_RULES',
    '- In llm.step, do not output action=read.',
    '- If user request is informational and can be answered from visibleTasks/context, action must be noAction.',
    '- Do not create follow-up tasks/reminders automatically.',
    '- Use action=write only when user explicitly requests create/update/delete/complete operations.',
    '- response is shown directly to end users.',
    '- end users do not know JSON/schema/processors/pipeline.',
    '- never mention JSON, schema, tool name, processor name, or internal step names in response.',
    '- write action: response must be a clear confirmation question to users.',
    '- noAction action: response must be a direct final answer.',
  ].join('\n');
}

function buildPreflightMachineRules() {
  return [
    'PREFLIGHT_RULES',
    '- Your JSON is consumed by system code for routing and data fetching.',
    '- Prioritize stable machine-readable output over conversational style.',
    '- For pure information requests (query/list/search/count/check), choose action=read.',
    '- For create/update/delete/complete/archive requests, choose action=write.',
    '- If no DB action is needed, use noAction.',
    '- Never choose write just to ask clarification or provide options.',
    '- For read/write actions, provide only valid methods with positional args.',
  ].join('\n');
}

/**
 * Legacy direct-chat prompt.
 * Kept as lightweight fallback for the old direct router path.
 */
export function buildSystemPrompt({ selectedDate, tasks }) {
  const dateText = trimText(selectedDate) || 'unknown date';
  return [
    'You are Todo Calendar Assistant.',
    "Reply in the user's language.",
    'Keep the answer concise and practical.',
    `Selected date: ${dateText}`,
    'Task context:',
    buildTaskContext(tasks),
  ].join('\n');
}

/**
 * Structured-output system prompt for preflight.step.
 * This prompt is machine-oriented and optimized for stable routing JSON.
 */
export function buildPreflightSystemPrompt({
  selectedDate,
  tasks,
  currentTime,
  timezone,
  allowRead = true,
} = {}) {
  return [
    'ROLE',
    'You are Todo Calendar Preflight Planner.',
    "Use user's language only in reason/response string values.",
    '',
    buildJsonOutputHardRules(),
    '',
    buildPreflightMachineRules(),
    '',
    'ACTION_CONTRACT',
    buildActionJsonContract({ allowRead }),
    '',
    'AVAILABLE_PROCESSORS',
    buildProcessorInstructionTable({ includeRead: allowRead, includeWrite: true }),
    '',
    buildRuntimeContext({
      selectedDate,
      currentTime,
      timezone,
      tasks,
    }),
  ].join('\n');
}

/**
 * Structured-output system prompt for llm.step final response generation.
 * This prompt is user-facing aware: response will be shown directly in UI.
 */
export function buildLlmSystemPrompt({
  selectedDate,
  tasks,
  currentTime,
  timezone,
  allowRead = true,
} = {}) {
  return [
    'ROLE',
    'You are Todo Calendar Assistant.',
    "Use user's language only in reason/response string values.",
    '',
    buildJsonOutputHardRules(),
    '',
    buildLlmUserVisibleRules(),
    '',
    'ACTION_CONTRACT',
    buildActionJsonContract({ allowRead }),
    '',
    'AVAILABLE_PROCESSORS',
    buildProcessorInstructionTable({ includeRead: allowRead, includeWrite: true }),
    '',
    buildRuntimeContext({
      selectedDate,
      currentTime,
      timezone,
      tasks,
    }),
  ].join('\n');
}

/**
 * Backward-compatible alias used by existing imports.
 * Equivalent to llm prompt.
 */
export function buildPipelineSystemPrompt(options = {}) {
  return buildLlmSystemPrompt(options);
}
