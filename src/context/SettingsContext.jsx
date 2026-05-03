/**
 * SettingsContext
 * Loads all user settings from DB on app start.
 * Provides settings values and a setter that persists to DB.
 */
import React, { createContext, useContext, useState, useEffect } from 'react';

const isElectron = () => typeof window !== 'undefined' && !!window.db;

const SettingsContext = createContext({
  defaultTaskType: 'carry_over',
  setSetting: async () => {},
});

export function useSettings() {
  return useContext(SettingsContext);
}

export function SettingsProvider({ children }) {
  const [defaultTaskType, setDefaultTaskType] = useState('carry_over');

  // Load all settings from DB on mount
  useEffect(() => {
    if (!isElectron()) return;
    window.db.config.get('defaultTaskType').then((v) => {
      if (v) setDefaultTaskType(v);
    });
  }, []);

  // Persist a setting to DB and update context state
  const setSetting = async (key, value) => {
    if (isElectron()) await window.db.config.set(key, String(value));
    if (key === 'defaultTaskType') setDefaultTaskType(value);
  };

  return (
    <SettingsContext.Provider value={{ defaultTaskType, setSetting }}>
      {children}
    </SettingsContext.Provider>
  );
}

