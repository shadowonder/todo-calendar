/**
 * AI Layer: output sanitizer utility
 *
 * Responsibilities:
 * - normalize raw model text across providers
 * - strip hidden thinking tags from final assistant text
 * - expose a short thinking preview for frontend display when available
 *
 * Non-responsibilities:
 * - do not validate structured action schema
 * - do not route models
 * - do not execute actions
 *
 * Future extension:
 * - add provider-specific normalization quirks in this utility file.
 */
function normalizeLineBreaks(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

const THINK_TAGS = ['think', 'analysis', 'reasoning', 'thought'];
const THINK_BLOCK_PATTERN = '<(think|analysis|reasoning|thought)\\b[^>]*>[\\s\\S]*?<\\/\\1>';
const THINK_CAPTURE_PATTERN = '<(think|analysis|reasoning|thought)\\b[^>]*>([\\s\\S]*?)(?:<\\/\\1>|$)';

function normalizeLooseText(text) {
  return normalizeLineBreaks(text)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractThinkingText(rawText) {
  const source = typeof rawText === 'string' ? rawText : '';
  if (!source) return '';

  const text = normalizeLineBreaks(source);
  const parts = [];
  const regex = new RegExp(THINK_CAPTURE_PATTERN, 'gi');
  let match;

  while ((match = regex.exec(text)) !== null) {
    const body = typeof match[2] === 'string' ? match[2] : '';
    if (body.trim()) parts.push(body.trim());
    const tag = (match[1] || '').toLowerCase();
    if (!match[0].toLowerCase().includes(`</${tag}>`)) break;
  }

  return normalizeLooseText(parts.join('\n\n'));
}

export function buildThinkingPreview(rawText, maxLines = 3, maxChars = 280) {
  const thinking = extractThinkingText(rawText);
  if (!thinking) return '';

  const lines = thinking
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, Math.max(1, maxLines));

  let preview = lines.join('\n');
  if (preview.length > maxChars) {
    preview = `${preview.slice(0, Math.max(20, maxChars - 1)).trimEnd()}…`;
  }
  return preview;
}

export function sanitizeAssistantText(rawText) {
  let text = typeof rawText === 'string' ? rawText : '';
  if (!text) return '';

  text = normalizeLineBreaks(text);

  // Remove complete thinking blocks first.
  text = text.replace(new RegExp(THINK_BLOCK_PATTERN, 'gi'), ' ');

  // Remove orphan thinking tags and trailing leaked reasoning text.
  for (const tag of THINK_TAGS) {
    const openIndex = text.toLowerCase().indexOf(`<${tag}`);
    if (openIndex >= 0) {
      text = text.slice(0, openIndex);
    }
    text = text.replace(new RegExp(`</${tag}>`, 'gi'), ' ');
  }

  return normalizeLooseText(text);
}
