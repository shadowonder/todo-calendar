import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { createTheme, ThemeProvider } from '@mui/material';

const ColorModeContext = createContext({ darkMode: false, toggleDarkMode: () => {} });

export function useColorMode() {
  return useContext(ColorModeContext);
}

const isElectron = () => typeof window !== 'undefined' && !!window.db;

export function AppThemeProvider({ children }) {
  const [darkMode, setDarkMode] = useState(false);

  // Load saved preference from DB on mount
  useEffect(() => {
    if (!isElectron()) return;
    window.db.config.get('darkMode').then((val) => {
      if (val !== null) setDarkMode(val === 'true');
    });
  }, []);

  const toggleDarkMode = async () => {
    const next = !darkMode;
    setDarkMode(next);
    if (isElectron()) {
      await window.db.config.set('darkMode', String(next));
    }
  };

  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: darkMode ? 'dark' : 'light',
          primary: { main: '#4f8ef7', light: '#82b1ff', dark: '#2563eb', contrastText: '#fff' },
          success: { main: '#4ade80' },
          error: { main: '#f87171' },
          background: darkMode
            ? {
                default: '#0e1117', // main area — very dark navy-black
                paper: '#161b27', // panels / cards — slightly lighter
              }
            : {
                default: '#f0f2f7',
                paper: '#ffffff',
              },
          text: darkMode
            ? { primary: '#e2e8f0', secondary: '#8892a4', disabled: '#4a5568' }
            : { primary: '#1a202c', secondary: '#718096', disabled: '#a0aec0' },
          divider: darkMode ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.09)',
          action: darkMode
            ? {
                hover: 'rgba(255,255,255,0.05)',
                selected: 'rgba(79,142,247,0.15)',
                disabled: 'rgba(255,255,255,0.2)',
              }
            : {
                hover: 'rgba(0,0,0,0.04)',
                selected: 'rgba(79,142,247,0.12)',
              },
        },
        shape: { borderRadius: 8 },
        components: {
          MuiPaper: {
            styleOverrides: {
              root: { backgroundImage: 'none' },
            },
          },
          MuiDrawer: {
            styleOverrides: {
              paper: { backgroundImage: 'none' },
            },
          },
          MuiListItemButton: {
            styleOverrides: {
              // Remove the default grey ripple/hover background that MUI injects
              root: { '&.Mui-selected': { backgroundColor: 'transparent' } },
            },
          },
          MuiOutlinedInput: {
            styleOverrides: {
              root: ({ theme }) => ({
                backgroundColor: theme.palette.background.paper,
              }),
            },
          },
          MuiDivider: {
            styleOverrides: {
              root: ({ theme }) => ({ borderColor: theme.palette.divider }),
            },
          },
        },
      }),
    [darkMode]
  );

  return (
    <ColorModeContext.Provider value={{ darkMode, toggleDarkMode }}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </ColorModeContext.Provider>
  );
}
