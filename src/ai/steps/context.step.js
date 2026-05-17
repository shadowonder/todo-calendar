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
import { buildFirstActionPrompt } from '../prompts/basePrompt.js';
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
  const basePrompt = buildFirstActionPrompt({
    selectedDate,
    tasks,
    userQuery: normalizedPrompt,
  });

  return {
    userPrompt: normalizedPrompt,
    currentTime: nowIso,
    timezone: tz,
    basePrompt,
    actionInstructionTable,
    actionJsonContract,
    outputSchemaInfo: {
      name: OPENAI_ACTION_RESPONSE_FORMAT?.json_schema?.name || 'todo_calendar_action_response',
      strict: Boolean(OPENAI_ACTION_RESPONSE_FORMAT?.json_schema?.strict),
    },
    modelInput: {
      systemPrompt: [
        basePrompt,
        '',
        `Current time (ISO): ${nowIso}`,
        `Timezone: ${tz}`,
      ].join('\n'),
      userPromptText: normalizedPrompt || 'No user prompt provided.',
      allowRead,
      preferVercelSdk,
    },
  };
}
