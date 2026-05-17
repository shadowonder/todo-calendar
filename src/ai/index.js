/**
 * AI Layer: external entrypoint
 *
 * Responsibilities:
 * - expose stable public APIs of the ai module
 * - keep external imports simple and centralized
 *
 * Non-responsibilities:
 * - do not hold business logic implementation
 * - do not orchestrate steps directly here
 *
 * Future extension:
 * - add curated exports only; avoid leaking internal folder structure.
 */
export { runAiPipeline } from './pipeline.js';
export {
  getProviderLabel,
  requestAssistantReply,
  preloadNativeModel,
  releaseNativeModel,
} from './model/modelRouter.js';
export {
  OPENAI_ACTION_RESPONSE_FORMAT,
  getOpenAIActionResponseFormat,
} from './schemas/openaiActionResponseFormat.js';
