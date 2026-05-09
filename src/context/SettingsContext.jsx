/**
 * SettingsContext
 * Loads all user settings from DB on app start.
 * Provides settings values and a setter that persists to DB.
 */
import React, { createContext, useContext, useState, useEffect, useRef } from 'react';

const isElectron = () => typeof window !== 'undefined' && !!window.db;

const AI_TYPES = new Set(['native', 'apikey', 'oauth', 'restapi']);
const NON_NATIVE_TYPES = new Set(['apikey', 'oauth', 'restapi']);

const DEFAULT_AI_CONNECTION = {
  type: 'native',
  lastNonNativeType: 'apikey',
  modelUrl: '',
  native: {
    memoryQuota: '',
  },
  apiKey: {
    url: '',
    key: '',
  },
  oauth: {
    url: '',
    clientId: '',
    clientSecret: '',
  },
  rest: {
    url: '',
    method: 'POST',
    requestBody: '',
  },
};

function normalizeAiConnection(raw) {
  const v = raw && typeof raw === 'object' ? raw : {};
  const type = AI_TYPES.has(v.type) ? v.type : DEFAULT_AI_CONNECTION.type;
  const inferredNonNativeType = (() => {
    if (NON_NATIVE_TYPES.has(v.lastNonNativeType)) return v.lastNonNativeType;
    if (NON_NATIVE_TYPES.has(type)) return type;
    if (typeof v?.oauth?.url === 'string' && v.oauth.url.trim()) return 'oauth';
    if (typeof v?.rest?.url === 'string' && v.rest.url.trim()) return 'restapi';
    if (typeof v?.apiKey?.url === 'string' && v.apiKey.url.trim()) return 'apikey';
    return DEFAULT_AI_CONNECTION.lastNonNativeType;
  })();
  const restMethod = String(v?.rest?.method || '').toUpperCase() === 'GET' ? 'GET' : 'POST';

  return {
    type,
    lastNonNativeType: inferredNonNativeType,
    modelUrl: typeof v.modelUrl === 'string' ? v.modelUrl : DEFAULT_AI_CONNECTION.modelUrl,
    native: {
      memoryQuota:
        v?.native?.memoryQuota === null || v?.native?.memoryQuota === undefined
          ? DEFAULT_AI_CONNECTION.native.memoryQuota
          : String(v.native.memoryQuota),
    },
    apiKey: {
      url: typeof v?.apiKey?.url === 'string' ? v.apiKey.url : DEFAULT_AI_CONNECTION.apiKey.url,
      key: typeof v?.apiKey?.key === 'string' ? v.apiKey.key : DEFAULT_AI_CONNECTION.apiKey.key,
    },
    oauth: {
      url: typeof v?.oauth?.url === 'string' ? v.oauth.url : DEFAULT_AI_CONNECTION.oauth.url,
      clientId: typeof v?.oauth?.clientId === 'string' ? v.oauth.clientId : DEFAULT_AI_CONNECTION.oauth.clientId,
      clientSecret: typeof v?.oauth?.clientSecret === 'string' ? v.oauth.clientSecret : DEFAULT_AI_CONNECTION.oauth.clientSecret,
    },
    rest: {
      url: typeof v?.rest?.url === 'string' ? v.rest.url : DEFAULT_AI_CONNECTION.rest.url,
      method: restMethod,
      requestBody: typeof v?.rest?.requestBody === 'string' ? v.rest.requestBody : DEFAULT_AI_CONNECTION.rest.requestBody,
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
    auth: null,
  },
  setSetting: async () => {},
  setAiConnection: async () => {},
  setAiConnectionType: async () => {},
  setNativeMode: async () => {},
  setAiModelUrl: async () => {},
  updateAiNative: async () => {},
  updateAiApiKey: async () => {},
  updateAiOauth: async () => {},
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
        auth: { ...aiConnection.native },
      };
    }
    if (activeExternalType === 'oauth') {
      return {
        type: 'oauth',
        modelUrl: aiConnection.modelUrl,
        auth: { ...aiConnection.oauth },
      };
    }
    if (activeExternalType === 'restapi') {
      return {
        type: 'restapi',
        modelUrl: aiConnection.modelUrl,
        auth: { ...aiConnection.rest },
      };
    }
    return {
      type: 'apikey',
      modelUrl: aiConnection.modelUrl,
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

  const updateAiOauth = async (patch = {}) => {
    await setAiConnection((prev) => ({
      ...prev,
      oauth: { ...prev.oauth, ...patch },
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
        updateAiNative,
        updateAiApiKey,
        updateAiOauth,
        updateAiRest,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}
