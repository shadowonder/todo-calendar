/**
 * AI Layer: pipeline step (context)
 *
 * Responsibilities:
 * - receive user prompt and assemble minimal AI context
 * - prepare prompt resources + schema/catalog description for model step
 *
 * Non-responsibilities:
 * - do not call LLM providers
 * - do not validate LLM outputs
 * - do not execute actions / DB / UI logic
 *
 * Future extension:
 * - analyzer, retriever, query rewrite, plugin/tool context can be appended here.
 */
import { buildActionJsonContract, buildProcessorInstructionTable } from '../actions/actionCatalog.js';
import {
  buildLlmSystemPrompt,
  buildPreflightSystemPrompt,
} from '../prompts/basePrompt.js';
import { OPENAI_ACTION_RESPONSE_FORMAT } from '../schemas/openaiActionResponseFormat.js';

function resolveNowIso(currentTime) {
  if (typeof currentTime === 'string' && currentTime.trim()) return currentTime;
  return new Date().toISOString();
}

function resolveTimezone(timezone) {
  if (typeof timezone === 'string' && timezone.trim()) return timezone;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export async function runContextStep({
  userPrompt,
  selectedDate,
  tasks,
  currentTime,
  timezone,
  allowRead = true,
  preferVercelSdk = false,
} = {}) {
  const normalizedPrompt = typeof userPrompt === 'string' ? userPrompt.trim() : '';
  const nowIso = resolveNowIso(currentTime);
  const tz = resolveTimezone(timezone);

  const actionInstructionTable = buildProcessorInstructionTable({
    includeRead: allowRead,
    includeWrite: true,
  });
  const actionJsonContract = buildActionJsonContract({ allowRead });
  const preflightPrompt = buildPreflightSystemPrompt({
    selectedDate,
    tasks,
    currentTime: nowIso,
    timezone: tz,
    allowRead,
  });
  const llmPrompt = buildLlmSystemPrompt({
    selectedDate,
    tasks,
    currentTime: nowIso,
    timezone: tz,
    allowRead: false,
  });

  return {
    selectedDate,
    sourceTasks: Array.isArray(tasks) ? tasks : [],
    userPrompt: normalizedPrompt,
    currentTime: nowIso,
    timezone: tz,
    basePrompt: llmPrompt,
    actionInstructionTable,
    actionJsonContract,
    outputSchemaInfo: {
      name: OPENAI_ACTION_RESPONSE_FORMAT?.json_schema?.name || 'todo_calendar_action_response',
      strict: Boolean(OPENAI_ACTION_RESPONSE_FORMAT?.json_schema?.strict),
    },
    modelInput: {
      // Keep a default prompt for backward compatibility.
      systemPrompt: preflightPrompt,
      preflightSystemPrompt: preflightPrompt,
      llmSystemPrompt: llmPrompt,
      userPromptText: normalizedPrompt || 'No user prompt provided.',
      allowRead,
      preferVercelSdk,
    },
  };
}
