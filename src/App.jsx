import React, { useEffect, useRef, useState } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import {
  Box, Drawer, List, ListItemButton, ListItemIcon, ListItemText,
  IconButton, Tooltip, Divider, Typography, Snackbar, Alert,
} from '@mui/material';
import {
  CalendarMonth as CalendarMonthIcon,
  NoteAdd as NoteAddIcon,
  Settings as SettingsIcon,
  ChevronLeft as ChevronLeftIcon,
  Menu as MenuIcon,
  DarkMode as DarkModeIcon,
  LightMode as LightModeIcon,
} from '@mui/icons-material';

import CalendarPage from './pages/CalendarPage.jsx';
import NotesPage from './pages/NotesPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import { preloadNativeModel, releaseNativeModel } from './ai/client.js';
import { getTierLabel } from './ai/nativeModels.js';
import { useColorMode } from './context/ThemeContext.jsx';
import { useSettings } from './context/SettingsContext.jsx';

const DRAWER_OPEN = 240;
const DRAWER_CLOSED = 64;

const NAV = [
  { label: 'Calendar', icon: <CalendarMonthIcon />, path: '/' },
  { label: 'Notes', icon: <NoteAddIcon />, path: '/notes' },
  { label: 'Settings', icon: <SettingsIcon />, path: '/settings' },
];

export default function App() {
  const [open, setOpen] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const { darkMode, toggleDarkMode } = useColorMode();
  const { aiConnection, isNativeMode } = useSettings();
  const [nativeModelStatus, setNativeModelStatus] = useState({
    phase: 'idle',
    tier: '',
  });
  const [nativeBanner, setNativeBanner] = useState({
    open: false,
    message: '',
    severity: 'success',
  });
  const lastReadyModelRef = useRef('');

  useEffect(() => {
    let cancelled = false;

    if (!isNativeMode) {
      setNativeModelStatus({ phase: 'idle', tier: '' });
      return () => {
        cancelled = true;
      };
    }

    if (location.pathname !== '/') {
      return () => {
        cancelled = true;
      };
    }

    setNativeModelStatus((prev) => ({ phase: 'loading', tier: prev.tier || '' }));

    const connection = {
      type: 'native',
      auth: { modelTier: aiConnection.native.modelTier },
    };
    void preloadNativeModel(connection)
      .then((result) => {
        if (cancelled || !result?.model) return;
        const selectedTier = typeof result?.selectedTier === 'string' ? result.selectedTier : '';
        setNativeModelStatus({ phase: 'ready', tier: selectedTier });
        if (lastReadyModelRef.current === result.model) return;

        lastReadyModelRef.current = result.model;
        const tierLabel = getTierLabel(selectedTier);
        setNativeBanner({
          open: true,
          message: result.fallbackUsed
            ? 'Native profile ready (fallback active).'
            : `Native profile ready: ${tierLabel}`,
          severity: result.fallbackUsed ? 'warning' : 'success',
        });
      })
      .catch((_err) => {
        if (cancelled) return;
        setNativeModelStatus((prev) => ({ phase: 'error', tier: prev.tier || '' }));
        setNativeBanner({
          open: true,
          message: 'Failed to prepare native profile. Try a lighter profile in Settings.',
          severity: 'error',
        });
      });

    return () => {
      cancelled = true;
    };
  }, [isNativeMode, location.pathname, aiConnection.native.modelTier]);

  useEffect(() => {
    let cancelled = false;
    if (isNativeMode) return () => {
      cancelled = true;
    };

    void releaseNativeModel()
      .then(() => {
        if (cancelled) return;
        lastReadyModelRef.current = '';
        setNativeModelStatus({ phase: 'idle', tier: '' });
      })
      .catch(() => {
        // Ignore release errors while switching provider mode.
      });

    return () => {
      cancelled = true;
    };
  }, [isNativeMode]);

  // Sidebar is always dark in both modes — text is always light
  const sidebarBg    = darkMode ? '#0a0e17' : '#1e2640';
  const activeColor  = '#82b1ff';
  const mutedText    = 'rgba(255,255,255,0.4)';
  const normalText   = 'rgba(255,255,255,0.85)';
  const activeBg     = 'rgba(130,177,255,0.16)';
  const hoverBg      = 'rgba(255,255,255,0.06)';

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden', bgcolor: 'background.default' }}>
      {/* Sidebar */}
      <Drawer
        variant="permanent"
        sx={{
          width: open ? DRAWER_OPEN : DRAWER_CLOSED,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: open ? DRAWER_OPEN : DRAWER_CLOSED,
            overflowX: 'hidden',
            transition: 'width 0.2s',
            boxSizing: 'border-box',
            bgcolor: sidebarBg,
            borderRight: `1px solid rgba(255,255,255,0.05)`,
          },
        }}
      >
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', px: 1, py: 1.5, minHeight: 56 }}>
          {open && (
            <Typography variant="h6" sx={{ fontWeight: 700, color: activeColor, flexGrow: 1, pl: 1, fontSize: 15, letterSpacing: 0.3 }}>
              Todo Calendar
            </Typography>
          )}
          <IconButton onClick={() => setOpen(!open)} sx={{ color: mutedText, ml: open ? 0 : 'auto', mr: open ? 0 : 'auto', '&:hover': { color: normalText, bgcolor: hoverBg } }}>
            {open ? <ChevronLeftIcon /> : <MenuIcon />}
          </IconButton>
        </Box>

        <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)' }} />

        <List sx={{ mt: 1, px: 0 }}>
          {NAV.map(({ label, icon, path }) => {
            const active = location.pathname === path;
            return (
              <Tooltip key={path} title={open ? '' : label} placement="right">
                <ListItemButton
                  onClick={() => navigate(path)}
                  disableRipple={false}
                  sx={{
                    mx: 1, mb: 0.5, borderRadius: 2,
                    bgcolor: active ? activeBg : 'transparent',
                    '&:hover': { bgcolor: active ? activeBg : hoverBg },
                    justifyContent: open ? 'initial' : 'center',
                    px: open ? 2 : 1.5,
                    py: 1,
                    // Override MUI's built-in selected state grey
                    '&.Mui-selected, &.Mui-selected:hover': { bgcolor: activeBg },
                  }}
                >
                  <ListItemIcon sx={{ color: active ? activeColor : mutedText, minWidth: open ? 38 : 'unset', transition: 'color 0.15s' }}>
                    {icon}
                  </ListItemIcon>
                  {open && (
                    <ListItemText
                      primary={
                        <Typography sx={{ fontSize: 13.5, fontWeight: active ? 600 : 400, color: active ? activeColor : normalText, lineHeight: 1.4 }}>
                          {label}
                        </Typography>
                      }
                    />
                  )}
                </ListItemButton>
              </Tooltip>
            );
          })}
        </List>

        {/* Dark mode toggle at bottom */}
        <Box sx={{ mt: 'auto', px: 1, pb: 2 }}>
          <Divider sx={{ borderColor: 'rgba(255,255,255,0.06)', mb: 1 }} />
          <Tooltip title={darkMode ? 'Light mode' : 'Dark mode'} placement="right">
            <ListItemButton
              onClick={toggleDarkMode}
              sx={{
                borderRadius: 2,
                justifyContent: open ? 'initial' : 'center',
                px: open ? 2 : 1.5, py: 1,
                bgcolor: 'transparent',
                '&:hover': { bgcolor: hoverBg },
              }}
            >
              <ListItemIcon sx={{ color: mutedText, minWidth: open ? 38 : 'unset' }}>
                {darkMode ? <LightModeIcon /> : <DarkModeIcon />}
              </ListItemIcon>
              {open && (
                <ListItemText
                  primary={
                    <Typography sx={{ fontSize: 13.5, color: normalText, lineHeight: 1.4 }}>
                      {darkMode ? 'Light Mode' : 'Dark Mode'}
                    </Typography>
                  }
                />
              )}
            </ListItemButton>
          </Tooltip>
        </Box>
      </Drawer>

      {/* Main content */}
      <Box component="main" sx={{ flexGrow: 1, overflow: 'auto', bgcolor: 'background.default' }}>
        <Routes>
          <Route
            path="/"
            element={
              <CalendarPage
                nativeChatStatus={{
                  enabled: isNativeMode,
                  phase: nativeModelStatus.phase,
                  tier: nativeModelStatus.tier,
                }}
              />
            }
          />
          <Route path="/notes" element={<NotesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </Box>

      <Snackbar
        open={nativeBanner.open}
        autoHideDuration={2600}
        onClose={() => setNativeBanner((prev) => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={nativeBanner.severity}
          onClose={() => setNativeBanner((prev) => ({ ...prev, open: false }))}
        >
          {nativeBanner.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
