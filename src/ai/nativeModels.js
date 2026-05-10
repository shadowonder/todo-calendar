import configJson from './native-model-config.json';

const AUTO_TIER_ID = 'auto';
const FALLBACK_CONFIG = {
  autoPolicy: {
    defaultTier: 'balanced',
    deviceMemoryGB: [
      { min: 8, tier: 'high' },
      { min: 4, tier: 'balanced' },
      { min: 2, tier: 'light' },
      { min: 0, tier: 'tiny' },
    ],
    hardwareConcurrency: [
      { min: 12, tier: 'balanced' },
      { min: 6, tier: 'light' },
      { min: 0, tier: 'tiny' },
    ],
  },
  tiers: [
    {
      id: 'high',
      label: 'High Quality (5-8 GB)',
      modelId: 'Llama-3.1-8B-Instruct-q4f16_1-MLC',
      approxVramMB: 5001,
    },
    {
      id: 'balanced',
      label: 'Balanced (3-5 GB)',
      modelId: 'Phi-4-mini-instruct-q4f16_1-MLC',
      approxVramMB: 3437.58,
    },
    {
      id: 'light',
      label: 'Lightweight (1-3 GB)',
      modelId: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
      approxVramMB: 1629.75,
    },
    {
      id: 'tiny',
      label: 'Low Memory (0.5-1 GB)',
      modelId: 'SmolLM2-360M-Instruct-q4f32_1-MLC',
      approxVramMB: 579.61,
    },
  ],
};

function toPositiveNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function normalizeTier(raw, index) {
  const id = typeof raw?.id === 'string' ? raw.id.trim() : '';
  const label = typeof raw?.label === 'string' ? raw.label.trim() : '';
  const modelId = typeof raw?.modelId === 'string' ? raw.modelId.trim() : '';
  const approxVramMB = Number(raw?.approxVramMB);
  if (!id || !label || !modelId || !Number.isFinite(approxVramMB) || approxVramMB <= 0) return null;
  return {
    id,
    label,
    modelId,
    approxVramMB,
    order: index,
  };
}

function uniqueById(list) {
  const seen = new Set();
  return list.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function normalizeRules(rawRules, allowedTierIds) {
  const rules = Array.isArray(rawRules) ? rawRules : [];
  return rules
    .map((rule) => {
      const min = Number(rule?.min);
      const tier = typeof rule?.tier === 'string' ? rule.tier.trim() : '';
      if (!Number.isFinite(min) || !tier || !allowedTierIds.has(tier)) return null;
      return { min, tier };
    })
    .filter(Boolean)
    .sort((a, b) => b.min - a.min);
}

function normalizeConfig(inputConfig) {
  const source = inputConfig && typeof inputConfig === 'object' ? inputConfig : FALLBACK_CONFIG;
  const tierCandidates = (Array.isArray(source.tiers) ? source.tiers : FALLBACK_CONFIG.tiers)
    .map(normalizeTier)
    .filter(Boolean);
  const tiers = uniqueById(tierCandidates);
  if (tiers.length === 0) {
    return normalizeConfig(FALLBACK_CONFIG);
  }

  const tierIdSet = new Set(tiers.map((item) => item.id));
  const autoPolicy = source.autoPolicy && typeof source.autoPolicy === 'object'
    ? source.autoPolicy
    : FALLBACK_CONFIG.autoPolicy;
  const fallbackDefaultTier = FALLBACK_CONFIG.autoPolicy.defaultTier;
  const defaultTierRaw = typeof autoPolicy.defaultTier === 'string'
    ? autoPolicy.defaultTier.trim()
    : '';
  const defaultTier = tierIdSet.has(defaultTierRaw)
    ? defaultTierRaw
    : (tierIdSet.has(fallbackDefaultTier) ? fallbackDefaultTier : tiers[0].id);

  const deviceMemoryRules = normalizeRules(autoPolicy.deviceMemoryGB, tierIdSet);
  const hardwareConcurrencyRules = normalizeRules(autoPolicy.hardwareConcurrency, tierIdSet);

  return {
    autoPolicy: {
      defaultTier,
      deviceMemoryGB: deviceMemoryRules.length > 0
        ? deviceMemoryRules
        : normalizeRules(FALLBACK_CONFIG.autoPolicy.deviceMemoryGB, tierIdSet),
      hardwareConcurrency: hardwareConcurrencyRules.length > 0
        ? hardwareConcurrencyRules
        : normalizeRules(FALLBACK_CONFIG.autoPolicy.hardwareConcurrency, tierIdSet),
    },
    tiers,
  };
}

const NATIVE_MODEL_CONFIG = normalizeConfig(configJson);
const TIER_ORDER = NATIVE_MODEL_CONFIG.tiers.map((tier) => tier.id);
const TIER_MAP = new Map(NATIVE_MODEL_CONFIG.tiers.map((tier) => [tier.id, tier]));

export const NATIVE_MODEL_TIERS = NATIVE_MODEL_CONFIG.tiers.map((tier) => ({
  id: tier.id,
  label: tier.label,
  modelId: tier.modelId,
  approxVramMB: tier.approxVramMB,
}));
export const NATIVE_MODEL_TIER_OPTION_IDS = new Set([AUTO_TIER_ID, ...TIER_ORDER]);

export function getNativeRuntimeHints() {
  const nav = globalThis?.navigator;
  return {
    deviceMemoryGB: toPositiveNumber(nav?.deviceMemory),
    hardwareConcurrency: toPositiveNumber(nav?.hardwareConcurrency),
  };
}

function pickTierByRules(value, rules) {
  if (value === null) return null;
  const matched = rules.find((rule) => value >= rule.min);
  return matched?.tier || null;
}

export function pickAutoTier(runtimeHints = getNativeRuntimeHints()) {
  const byDeviceMemory = pickTierByRules(
    toPositiveNumber(runtimeHints?.deviceMemoryGB),
    NATIVE_MODEL_CONFIG.autoPolicy.deviceMemoryGB
  );
  if (byDeviceMemory) return byDeviceMemory;

  const byCpuThreads = pickTierByRules(
    toPositiveNumber(runtimeHints?.hardwareConcurrency),
    NATIVE_MODEL_CONFIG.autoPolicy.hardwareConcurrency
  );
  if (byCpuThreads) return byCpuThreads;

  return NATIVE_MODEL_CONFIG.autoPolicy.defaultTier;
}

function getTierById(id) {
  return TIER_MAP.get(id) || TIER_MAP.get(NATIVE_MODEL_CONFIG.autoPolicy.defaultTier) || NATIVE_MODEL_TIERS[0];
}

function buildTierFallbackModelIds(tierId) {
  const startIndex = Math.max(TIER_ORDER.indexOf(tierId), 0);
  return TIER_ORDER.slice(startIndex)
    .map((id) => getTierById(id)?.modelId)
    .filter((id, index, list) => Boolean(id) && list.indexOf(id) === index);
}

export function resolveNativeModelSelection(nativeConfig = {}, runtimeHints = getNativeRuntimeHints()) {
  const tierPreference = NATIVE_MODEL_TIER_OPTION_IDS.has(nativeConfig?.modelTier)
    ? nativeConfig.modelTier
    : AUTO_TIER_ID;
  const autoTier = pickAutoTier(runtimeHints);
  const selectedTier = tierPreference === AUTO_TIER_ID ? autoTier : tierPreference;
  const selectedTierRecord = getTierById(selectedTier);

  return {
    modelId: selectedTierRecord.modelId,
    fallbackModelIds: buildTierFallbackModelIds(selectedTierRecord.id),
    tierPreference,
    selectedTier: selectedTierRecord.id,
    autoTier,
    recommendedModelId: selectedTierRecord.modelId,
    runtimeHints,
  };
}

export function getTierLabel(tierId) {
  return getTierById(tierId)?.label || getTierById(NATIVE_MODEL_CONFIG.autoPolicy.defaultTier)?.label || 'Balanced';
}
