/**
 * SettingsContext
 * Loads all user settings from DB on app start.
 * Provides settings values and a setter that persists to DB.
 */
import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { NATIVE_MODEL_TIER_OPTION_IDS } from '../ai/nativeModels.js';

const isElectron = () => typeof window !== 'undefined' && !!window.db;

const AI_TYPES = new Set(['native', 'apikey', 'restapi']);
const NON_NATIVE_TYPES = new Set(['apikey', 'restapi']);
const DEFAULT_AI_CONNECTION = {
  type: 'native',
  lastNonNativeType: 'apikey',
  modelUrl: '',
  modelVersion: '',
  native: {
    memoryQuota: '',
    modelTier: 'auto',
  },
  apiKey: {
    key: '',
  },
  rest: {
    url: '',
    method: 'POST',
    headers: '',
    requestBody: '',
    responseField: 'token',
  },
};

function mapLegacyExternalType(type) {
  return type === 'oauth' ? 'restapi' : type;
}

function buildLegacyOauthRequestBody(oauth) {
  const clientId = typeof oauth?.clientId === 'string' ? oauth.clientId.trim() : '';
  const clientSecret = typeof oauth?.clientSecret === 'string' ? oauth.clientSecret.trim() : '';
  if (!clientId && !clientSecret) return DEFAULT_AI_CONNECTION.rest.requestBody;
  return JSON.stringify(
    {
      ...(clientId ? { client_id: clientId } : {}),
      ...(clientSecret ? { client_secret: clientSecret } : {}),
    },
    null,
    2
  );
}

function normalizeAiConnection(raw) {
  const v = raw && typeof raw === 'object' ? raw : {};
  const normalizedType = mapLegacyExternalType(v.type);
  const type = AI_TYPES.has(normalizedType) ? normalizedType : DEFAULT_AI_CONNECTION.type;
  const normalizedLastNonNativeType = mapLegacyExternalType(v.lastNonNativeType);
  const legacyOauthUrl = typeof v?.oauth?.url === 'string' ? v.oauth.url : '';
  const restUrl =
    typeof v?.rest?.url === 'string' && v.rest.url.trim()
      ? v.rest.url
      : legacyOauthUrl;
  const inferredNonNativeType = (() => {
    if (NON_NATIVE_TYPES.has(normalizedLastNonNativeType)) return normalizedLastNonNativeType;
    if (NON_NATIVE_TYPES.has(type)) return type;
    if (typeof restUrl === 'string' && restUrl.trim()) return 'restapi';
    if (typeof v?.apiKey?.key === 'string' && v.apiKey.key.trim()) return 'apikey';
    return DEFAULT_AI_CONNECTION.lastNonNativeType;
  })();
  const restMethod = String(v?.rest?.method || '').toUpperCase() === 'GET' ? 'GET' : 'POST';
  const restHeaders =
    typeof v?.rest?.headers === 'string'
      ? v.rest.headers
      : (typeof v?.rest?.header === 'string' ? v.rest.header : DEFAULT_AI_CONNECTION.rest.headers);
  const restRequestBody =
    typeof v?.rest?.requestBody === 'string'
      ? v.rest.requestBody
      : buildLegacyOauthRequestBody(v?.oauth);
  const restResponseField =
    // Default to "token" so legacy configs without this field still work out of the box.
    typeof v?.rest?.responseField === 'string' && v.rest.responseField.trim()
      ? v.rest.responseField
      : DEFAULT_AI_CONNECTION.rest.responseField;

  return {
    type,
    lastNonNativeType: inferredNonNativeType,
    modelUrl: typeof v.modelUrl === 'string' ? v.modelUrl : DEFAULT_AI_CONNECTION.modelUrl,
    modelVersion: typeof v.modelVersion === 'string' ? v.modelVersion : DEFAULT_AI_CONNECTION.modelVersion,
    native: {
      memoryQuota:
        v?.native?.memoryQuota === null || v?.native?.memoryQuota === undefined
          ? DEFAULT_AI_CONNECTION.native.memoryQuota
          : String(v.native.memoryQuota),
      modelTier: NATIVE_MODEL_TIER_OPTION_IDS.has(v?.native?.modelTier)
        ? v.native.modelTier
        : DEFAULT_AI_CONNECTION.native.modelTier,
    },
    apiKey: {
      key: typeof v?.apiKey?.key === 'string' ? v.apiKey.key : DEFAULT_AI_CONNECTION.apiKey.key,
    },
    rest: {
      url: restUrl,
      method: restMethod,
      headers: restHeaders,
      requestBody: restRequestBody,
      responseField: restResponseField,
    },
  };
}

const SettingsContext = createContext({
  defaultTaskType: 'carry_over',
  aiConnection: DEFAULT_AI_CONNECTION,
  isNativeMode: true,
  activeExternalType: 'apikey',
  effectiveAiConnection: {
    type: 'native',
    modelUrl: '',
    modelVersion: '',
    auth: null,
  },
  setSetting: async () => {},
  setAiConnection: async () => {},
  setAiConnectionType: async () => {},
  setNativeMode: async () => {},
  setAiModelUrl: async () => {},
  setAiModelVersion: async () => {},
  updateAiNative: async () => {},
  updateAiApiKey: async () => {},
  updateAiRest: async () => {},
});

export function useSettings() {
  return useContext(SettingsContext);
}

export function SettingsProvider({ children }) {
  const [defaultTaskType, setDefaultTaskType] = useState('carry_over');
  const [aiConnection, setAiConnectionState] = useState(DEFAULT_AI_CONNECTION);
  const aiConnectionRef = useRef(DEFAULT_AI_CONNECTION);

  const activeExternalType =
    NON_NATIVE_TYPES.has(aiConnection.type)
      ? aiConnection.type
      : (NON_NATIVE_TYPES.has(aiConnection.lastNonNativeType) ? aiConnection.lastNonNativeType : 'apikey');
  const isNativeMode = aiConnection.type === 'native';

  const effectiveAiConnection = (() => {
    if (isNativeMode) {
      return {
        type: 'native',
        modelUrl: '',
        modelVersion: '',
        auth: { ...aiConnection.native },
      };
    }
    if (activeExternalType === 'restapi') {
      return {
        type: 'restapi',
        modelUrl: aiConnection.modelUrl,
        modelVersion: aiConnection.modelVersion,
        auth: { ...aiConnection.rest },
      };
    }
    return {
      type: 'apikey',
      modelUrl: aiConnection.modelUrl,
      modelVersion: aiConnection.modelVersion,
      auth: { ...aiConnection.apiKey },
    };
  })();

  // Load all settings from DB on mount
  useEffect(() => {
    if (!isElectron()) return;
    window.db.config.get('defaultTaskType').then((v) => {
      if (v) setDefaultTaskType(v);
    });
    window.db.config.get('aiConnection').then((v) => {
      if (!v) return;
      try {
        setAiConnectionState(normalizeAiConnection(JSON.parse(v)));
      } catch (e) {
        console.error('[SettingsContext] Failed to parse aiConnection:', e);
      }
    });
  }, []);

  useEffect(() => {
    aiConnectionRef.current = aiConnection;
  }, [aiConnection]);

  // Persist a setting to DB and update context state
  const setSetting = async (key, value) => {
    if (isElectron()) await window.db.config.set(key, String(value));
    if (key === 'defaultTaskType') setDefaultTaskType(value);
  };

  const setAiConnection = async (nextValue) => {
    const resolved = typeof nextValue === 'function' ? nextValue(aiConnectionRef.current) : nextValue;
    const next = normalizeAiConnection(resolved);
    aiConnectionRef.current = next;
    setAiConnectionState(next);
    if (isElectron()) {
      await window.db.config.set('aiConnection', JSON.stringify(next));
    }
  };

  const setAiConnectionType = async (type) => {
    if (type === 'native') {
      await setAiConnection((prev) => {
        const rememberedType = NON_NATIVE_TYPES.has(prev.type) ? prev.type : activeExternalType;
        return {
          ...prev,
          type: 'native',
          lastNonNativeType: rememberedType,
        };
      });
      return;
    }

    const nextType = NON_NATIVE_TYPES.has(type) ? type : 'apikey';
    await setAiConnection((prev) => ({
      ...prev,
      type: nextType,
      lastNonNativeType: nextType,
    }));
  };

  const setNativeMode = async (enabled) => {
    if (enabled) {
      await setAiConnectionType('native');
      return;
    }
    await setAiConnectionType(activeExternalType);
  };

  const setAiModelUrl = async (modelUrl) => {
    await setAiConnection((prev) => ({ ...prev, modelUrl: String(modelUrl ?? '') }));
  };

  const setAiModelVersion = async (modelVersion) => {
    await setAiConnection((prev) => ({ ...prev, modelVersion: String(modelVersion ?? '') }));
  };

  const updateAiNative = async (patch = {}) => {
    await setAiConnection((prev) => ({
      ...prev,
      native: { ...prev.native, ...patch },
    }));
  };

  const updateAiApiKey = async (patch = {}) => {
    await setAiConnection((prev) => ({
      ...prev,
      apiKey: { ...prev.apiKey, ...patch },
    }));
  };

  const updateAiRest = async (patch = {}) => {
    await setAiConnection((prev) => ({
      ...prev,
      rest: { ...prev.rest, ...patch },
    }));
  };

  return (
    <SettingsContext.Provider
      value={{
        defaultTaskType,
        aiConnection,
        isNativeMode,
        activeExternalType,
        effectiveAiConnection,
        setSetting,
        setAiConnection,
        setAiConnectionType,
        setNativeMode,
        setAiModelUrl,
        setAiModelVersion,
        updateAiNative,
        updateAiApiKey,
        updateAiRest,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}
