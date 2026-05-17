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
import actionResponseSchema from '../schemas/action-response.schema.json';
import {
  buildActionJsonContract,
  buildProcessorInstructionTable,
} from '../actions/actionCatalog.js';

const MAX_CONTEXT_TASKS = 12;

function trimText(value) {
  return typeof value === 'string' ? value.trim() : '';
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
 * Unified structured-output system prompt used by pipeline context.step.
 *
 * Sections:
 * - role definition
 * - JSON schema (source of truth)
 * - action contract summary
 * - available processors
 * - runtime context
 */
export function buildPipelineSystemPrompt({
  selectedDate,
  tasks,
  currentTime,
  timezone,
  allowRead = true,
} = {}) {
  const dateText = trimText(selectedDate) || 'unknown date';
  const nowText = trimText(currentTime) || new Date().toISOString();
  const tzText = trimText(timezone) || 'UTC';
  const taskContext = buildTaskContext(tasks);

  return [
    'ROLE',
    'You are Todo Calendar Structured Planner.',
    'Return exactly one JSON object and nothing else.',
    "Use the user's language only in JSON string fields such as response/reason.",
    'If action is "write", response must summarize planned writes and ask user confirmation.',
    '',
    'JSON_SCHEMA',
    JSON.stringify(actionResponseSchema, null, 2),
    '',
    'ACTION_CONTRACT',
    buildActionJsonContract({ allowRead }),
    '',
    'AVAILABLE_PROCESSORS',
    buildProcessorInstructionTable({ includeRead: allowRead, includeWrite: true }),
    '',
    'RUNTIME_CONTEXT',
    `selectedDate: ${dateText}`,
    `currentTime: ${nowText}`,
    `timezone: ${tzText}`,
    'visibleTasks:',
    taskContext,
  ].join('\n');
}
