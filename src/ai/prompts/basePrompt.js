/**
 * AI Layer: prompt resources
 *
 * Responsibilities:
 * - define reusable prompt builders
 * - keep system prompt compact and structured
 *
 * Non-responsibilities:
 * - do not call model providers
 * - do not validate model outputs
 * - do not execute actions or touch database/UI
 */
import {
  buildActionJsonContract,
  buildProcessorInstructionTable,
  buildProcessorPromptNotes,
} from '../actions/actionCatalog.js';

const MAX_CONTEXT_TASKS = 10;
const MAX_TEXT_LEN = 80;

function trimText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clipText(value, maxLen = MAX_TEXT_LEN) {
  const text = trimText(value);
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 3)}...`;
}

function pickTaskDate(task) {
  return trimText(task?.entry_date)
    || trimText(task?.start_date)
    || trimText(task?.origin_date)
    || '';
}

function normalizeBoolInt(value) {
  return value === 1 || value === true ? 1 : 0;
}

function nullableDate(value) {
  const text = trimText(value);
  return text || null;
}

function toTaskRow(task, index) {
  return {
    id: typeof task?.id === 'number' ? task.id : null,
    date: pickTaskDate(task),
    title: clipText(task?.title) || `Task ${index + 1}`,
    done: normalizeBoolInt(task?.done),
    prioritized: normalizeBoolInt(task?.prioritized),
    status: trimText(task?.entry_status) || (normalizeBoolInt(task?.done) ? 'done' : 'pending'),
    type: trimText(task?.task_type) || 'regular',
    start_date: nullableDate(task?.start_date),
    due_date: nullableDate(task?.due_date),
    end_date: nullableDate(task?.end_date),
    description: clipText(task?.description),
  };
}

function buildTaskContext(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return ['VISIBLE_TASKS_JSONL', '[]'].join('\n');
  }

  const rows = tasks
    .slice(0, MAX_CONTEXT_TASKS)
    .map((task, index) => JSON.stringify(toTaskRow(task, index)));

  return ['VISIBLE_TASKS_JSONL', ...rows].join('\n');
}

function buildRuntimeContext({
  selectedDate,
  currentTime,
  timezone,
  tasks,
} = {}) {
  const runtime = {
    selectedDate: trimText(selectedDate) || 'unknown-date',
    currentTime: trimText(currentTime) || new Date().toISOString(),
    timezone: trimText(timezone) || 'UTC',
  };

  const visibleTaskSchema = {
    id: 'number|null',
    date: 'YYYY-MM-DD|""',
    title: 'string',
    done: '0|1',
    prioritized: '0|1',
    status: 'pending|done|rolled|overdue|string',
    type: 'string',
    start_date: 'YYYY-MM-DD|null',
    due_date: 'YYYY-MM-DD|null',
    end_date: 'YYYY-MM-DD|null',
    description: 'string',
  };

  return [
    `CTX=${JSON.stringify(runtime)}`,
    `VISIBLE_TASK_SCHEMA=${JSON.stringify(visibleTaskSchema)}`,
    buildTaskContext(tasks),
  ].join('\n');
}

function buildMissionBlock({ stage } = {}) {
  const stageFocus = stage === 'preflight'
    ? '- Stage focus: choose route and define read plan when needed.'
    : '- Stage focus: produce final structured output from enriched context.';

  return [
    'MISSION',
    '- You are the AI reasoning layer for the Todo Calendar module.',
    '- Convert user intent into structured JSON for the current pipeline stage.',
    '- Database execution and UI rendering are handled by the application, not by you.',
    stageFocus,
  ].join('\n');
}

function buildJsonOutputHardRules({ allowRead = true } = {}) {
  const actionEnum = allowRead ? 'noAction|read|write' : 'noAction|write';
  return [
    'HARD_RULES',
    `- OUT={"action":"${actionEnum}","response":"string|null","actions":[{"reason":"string","method":"<method>","args":[...]}]}`,
    '- Return exactly one JSON object.',
    '- No markdown, no code fence, no prefix/suffix prose.',
    '- Top-level keys must be exactly: action,response,actions.',
    '- method must be in PROCESSOR_TABLE and cannot be null.',
    '- args must be positional array values only.',
    '- response must be plain text or null when allowed by contract.',
  ].join('\n');
}

function buildPreflightRules() {
  return [
    'PREFLIGHT_RULES',
    '- This stage decides route only: noAction, read, or write.',
    '- If additional database information is needed, choose action=read and provide read actions only.',
    '- For action=read, response should be null by default.',
    '- If write intent exists and required args are complete, choose action=write.',
    '- If required write args are missing or ambiguous, choose action=noAction with clarification response and actions=[].',
    '- Never put write methods under action=read.',
  ].join('\n');
}

function buildLlmRules() {
  return [
    'LLM_RULES',
    '- action=read is not allowed in this stage.',
    '- Use visibleTasks and runtime context as the source of truth for final output.',
    '- If request is informational and answerable from context, choose action=noAction.',
    '- Choose action=write only when user explicitly requests create/update/delete/complete and required args are complete.',
    '- If required write args are missing or ambiguous, choose action=noAction with clarification response and actions=[].',
    '- For action=write, response must be a declarative plain statement of planned changes.',
    '- Do not ask for execution confirmation in write response.',
    '- Do not mention internal pipeline/schema/tool terminology in user-facing response.',
  ].join('\n');
}

/**
 * Legacy direct-chat prompt.
 * Kept as lightweight fallback for the old direct router path.
 */
export function buildSystemPrompt({ selectedDate, tasks }) {
  return [
    'You are Todo Calendar Assistant.',
    'Reply in the user language. Keep concise and practical.',
    `selectedDate=${trimText(selectedDate) || 'unknown-date'}`,
    buildTaskContext(tasks),
  ].join('\n');
}

/**
 * Structured-output system prompt for preflight.step.
 * Machine-oriented: route decision and optional read planning.
 */
export function buildPreflightSystemPrompt({
  selectedDate,
  tasks,
  currentTime,
  timezone,
  allowRead = true,
} = {}) {
  return [
    'ROLE=TodoCalendarPreflightPlanner',
    'LANG=Use user language only inside reason/response string values.',
    buildMissionBlock({ stage: 'preflight' }),
    buildJsonOutputHardRules({ allowRead }),
    buildPreflightRules(),
    buildActionJsonContract({ allowRead }),
    buildProcessorInstructionTable({ includeRead: allowRead, includeWrite: true }),
    buildProcessorPromptNotes({ includeRead: allowRead, includeWrite: true }),
    buildRuntimeContext({ selectedDate, currentTime, timezone, tasks }),
  ].join('\n\n');
}

/**
 * Structured-output system prompt for llm.step.
 * User-facing: final structured response synthesis.
 */
export function buildLlmSystemPrompt({
  selectedDate,
  tasks,
  currentTime,
  timezone,
  allowRead = true,
} = {}) {
  void allowRead;
  const llmAllowRead = false;

  return [
    'ROLE=TodoCalendarAssistant',
    'LANG=Use user language only inside reason/response string values.',
    buildMissionBlock({ stage: 'llm' }),
    buildJsonOutputHardRules({ allowRead: llmAllowRead }),
    buildLlmRules(),
    buildActionJsonContract({ allowRead: llmAllowRead }),
    buildProcessorInstructionTable({ includeRead: llmAllowRead, includeWrite: true }),
    buildProcessorPromptNotes({ includeRead: llmAllowRead, includeWrite: true }),
    buildRuntimeContext({ selectedDate, currentTime, timezone, tasks }),
  ].join('\n\n');
}

/**
 * Backward-compatible alias used by existing imports.
 * Equivalent to llm prompt.
 */
export function buildPipelineSystemPrompt(options = {}) {
  return buildLlmSystemPrompt(options);
}
