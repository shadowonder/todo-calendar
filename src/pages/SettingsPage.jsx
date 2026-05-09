import React, { useState } from 'react';
import { Box, Typography, Paper, List, ListItem, ListItemText, Divider, Switch, Select, MenuItem, FormControl, Snackbar, Alert } from '@mui/material';
import { Settings as SettingsIcon } from '@mui/icons-material';
import { useColorMode } from '../context/ThemeContext.jsx';
import { useSettings } from '../context/SettingsContext.jsx';

export default function SettingsPage() {
  const { darkMode, toggleDarkMode } = useColorMode();
  const { defaultTaskType, setSetting } = useSettings();
  const [snack, setSnack] = useState(false);

  return (
    <Box sx={{ p: 3, maxWidth: 600 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <SettingsIcon color="primary" />
        <Typography variant="h6" fontWeight={700}>
          Settings
        </Typography>
      </Box>

      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        <List disablePadding>
          {/* Appearance */}
          <ListItem sx={{ bgcolor: 'action.hover' }}>
            <ListItemText
              primary={
                <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 1 }}>
                  Appearance
                </Typography>
              }
            />
          </ListItem>
          <Divider />

          <ListItem>
            <ListItemText primary="Dark Mode" secondary="Switch between light and dark theme" />
            <Switch
              checked={darkMode}
              onChange={async () => {
                await toggleDarkMode(); // ThemeContext already persists this to DB
                setSnack(true);
              }}
            />
          </ListItem>
          <Divider />

          {/* Tasks */}
          <ListItem sx={{ bgcolor: 'action.hover' }}>
            <ListItemText
              primary={
                <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 1 }}>
                  Tasks
                </Typography>
              }
            />
          </ListItem>
          <Divider />

          <ListItem>
            <ListItemText primary="Default task type" secondary="Schedule type pre-selected when adding a task" />
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <Select
                value={defaultTaskType}
                onChange={async (e) => {
                  await setSetting('defaultTaskType', e.target.value);
                  setSnack(true);
                }}
              >
                <MenuItem value="carry_over">Carry Over</MenuItem>
                <MenuItem value="fixed_day">Fixed Day</MenuItem>
              </Select>
            </FormControl>
          </ListItem>
          <Divider />

          {/* About */}
          <ListItem sx={{ bgcolor: 'action.hover' }}>
            <ListItemText
              primary={
                <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 1 }}>
                  About
                </Typography>
              }
            />
          </ListItem>
          <Divider />

          <ListItem>
            <ListItemText primary="Todo Calendar" secondary="Version 1.0.0" />
          </ListItem>
        </List>
      </Paper>

      <Snackbar open={snack} autoHideDuration={2000} onClose={() => setSnack(false)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="success" onClose={() => setSnack(false)}>
          Setting saved!
        </Alert>
      </Snackbar>
    </Box>
  );
}
