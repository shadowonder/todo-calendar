/**
 * Field Type Registry
 *
 * This file is the single source of truth for `fieldType` semantics.
 * Processors only declare symbolic field types such as `Date_Day` or `integer`.
 * Prompt builders and future validators both resolve those symbols here.
 *
 * The design goal is simple:
 * - `actionCatalog` declares processor capability shape
 * - `actionValidation` explains what each field type means
 * - prompt builders render those meanings into AI-facing instructions
 *
 * This keeps the processor registry clean while still giving us one stable
 * place to evolve validation rules later.
 */

export const FIELD_TYPE_MAP = {
  Date_Day: {
    kind: 'pattern',
    regex: '^\\d{4}-\\d{2}-\\d{2}$',
    promptToken: '/^\\d{4}-\\d{2}-\\d{2}$/',
  },

  Date_Month: {
    kind: 'pattern',
    regex: '^\\d{4}-\\d{2}$',
    promptToken: '/^\\d{4}-\\d{2}$/',
  },

  string: {
    kind: 'primitive',
    promptToken: 'string',
  },

  integer: {
    kind: 'primitive',
    promptToken: 'integer',
  },

  boolean: {
    kind: 'primitive',
    promptToken: 'boolean',
  },

  object: {
    kind: 'primitive',
    promptToken: 'object',
  },

  null: {
    kind: 'primitive',
    promptToken: 'null',
  },
};

/**
 * Convert one symbolic field type into the compact prompt token that AI sees.
 *
 * Examples:
 * - `Date_Day` -> `/^\\d{4}-\\d{2}-\\d{2}$/`
 * - `string|null` -> `string|null`
 * - `Date_Day|null` -> `/^\\d{4}-\\d{2}-\\d{2}$/|null`
 */
export function buildFieldPromptToken(fieldType) {
  const parts = typeof fieldType === 'string'
    ? fieldType.split('|').map((part) => part.trim()).filter(Boolean)
    : [];

  if (parts.length === 0) return 'unknown';
  return parts
    .map((typeName) => FIELD_TYPE_MAP[typeName]?.promptToken || typeName)
    .join('|');
}

/**
 * Build a short prompt block that documents only the non-obvious pattern types.
 * We intentionally omit primitives like `string` and `boolean` because those
 * add noise for the model without adding real clarity.
 */
export function buildPatternHintBlock() {
  const lines = Object.entries(FIELD_TYPE_MAP)
    .filter(([, rule]) => rule?.kind === 'pattern')
    .map(([typeName, rule]) => `- ${typeName} => ${rule.promptToken}`);

  return lines.length > 0
    ? ['Pattern hints:', ...lines, ''].join('\n')
    : '';
}
