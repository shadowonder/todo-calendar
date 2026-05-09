import React, { useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  List,
  ListItem,
  ListItemText,
  Divider,
  Switch,
  Select,
  MenuItem,
  FormControl,
  Snackbar,
  Alert,
  Tabs,
  Tab,
  TextField,
  Button,
} from '@mui/material';
import {
  Settings as SettingsIcon,
  NetworkCheckRounded as TestConnectionIcon,
} from '@mui/icons-material';
import { useColorMode } from '../context/ThemeContext.jsx';
import { useSettings } from '../context/SettingsContext.jsx';

export default function SettingsPage() {
  const { darkMode, toggleDarkMode } = useColorMode();
  const {
    defaultTaskType,
    aiConnection,
    isNativeMode,
    activeExternalType,
    setSetting,
    setNativeMode,
    setAiModelUrl,
    setAiConnectionType,
    updateAiApiKey,
    updateAiOauth,
    updateAiRest,
  } = useSettings();
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'success' });

  const showSnack = (message, severity = 'success') => {
    setSnack({ open: true, message, severity });
  };

  const tabToType = ['apikey', 'oauth', 'restapi'];
  const typeToTab = { apikey: 0, oauth: 1, restapi: 2 };
  const connectionTab = typeToTab[activeExternalType] ?? 0;

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
                showSnack('Setting saved!');
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
                  showSnack('Setting saved!');
                }}
              >
                <MenuItem value="carry_over">Carry Over</MenuItem>
                <MenuItem value="fixed_day">Fixed Day</MenuItem>
              </Select>
            </FormControl>
          </ListItem>
          <Divider />

          <ListItem sx={{ alignItems: 'flex-start', py: 2.25 }}>
            <Box sx={{ width: '100%' }}>
              <Typography variant="subtitle2" fontWeight={700}>
                Model Connection
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Configure model URL and authentication mode
              </Typography>

              <Box
                sx={{
                  mt: 1.25,
                  px: 1.25,
                  py: 1,
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1.5,
                  bgcolor: 'action.hover',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 1.5,
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={700}>
                    Use Native Runtime
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {isNativeMode ? 'Native mode is active now.' : 'External model connection is active now.'}
                  </Typography>
                </Box>
                <Switch
                  size="small"
                  checked={isNativeMode}
                  onChange={(e) => {
                    void setNativeMode(e.target.checked);
                  }}
                />
              </Box>

              <TextField
                fullWidth
                size="small"
                disabled={isNativeMode}
                label="Model URL"
                placeholder="https://api.example.com/v1/responses"
                value={aiConnection.modelUrl}
                onChange={(e) => {
                  void setAiModelUrl(e.target.value);
                }}
                sx={{ mt: 1.2 }}
              />

              {isNativeMode && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1.1 }}>
                  Use native runtime connection. External model URL and authentication method are currently ignored.
                </Typography>
              )}

              {!isNativeMode && (
                <Box sx={{ mt: 1.5, border: 1, borderColor: 'divider', borderRadius: 1.5, overflow: 'hidden' }}>
                  <Tabs
                    value={connectionTab}
                    onChange={(_, v) => {
                      const nextType = tabToType[v] || 'apikey';
                      void setAiConnectionType(nextType);
                    }}
                    variant="fullWidth"
                    sx={{ borderBottom: 1, borderColor: 'divider' }}
                  >
                    <Tab label="API Key" />
                    <Tab label="OAuth" />
                    <Tab label="REST API" />
                  </Tabs>

                  <Box sx={{ p: 1.5, display: 'grid', gap: 1.2 }}>
                    {connectionTab === 0 && (
                      <>
                        <TextField
                          fullWidth
                          size="small"
                          label="Auth URL"
                          placeholder="https://auth.example.com/apikey"
                          value={aiConnection.apiKey.url}
                          onChange={(e) => {
                            void updateAiApiKey({ url: e.target.value });
                          }}
                        />
                        <TextField
                          fullWidth
                          size="small"
                          type="password"
                          label="API Key"
                          placeholder="sk-..."
                          value={aiConnection.apiKey.key}
                          onChange={(e) => {
                            void updateAiApiKey({ key: e.target.value });
                          }}
                        />
                      </>
                    )}

                    {connectionTab === 1 && (
                      <>
                        <TextField
                          fullWidth
                          size="small"
                          label="Auth URL"
                          placeholder="https://auth.example.com/oauth/token"
                          value={aiConnection.oauth.url}
                          onChange={(e) => {
                            void updateAiOauth({ url: e.target.value });
                          }}
                        />
                        <TextField
                          fullWidth
                          size="small"
                          label="Client ID"
                          value={aiConnection.oauth.clientId}
                          onChange={(e) => {
                            void updateAiOauth({ clientId: e.target.value });
                          }}
                        />
                        <TextField
                          fullWidth
                          size="small"
                          type="password"
                          label="Client Secret"
                          value={aiConnection.oauth.clientSecret}
                          onChange={(e) => {
                            void updateAiOauth({ clientSecret: e.target.value });
                          }}
                        />
                      </>
                    )}

                    {connectionTab === 2 && (
                      <>
                        <TextField
                          fullWidth
                          size="small"
                          label="Auth URL"
                          placeholder="https://auth.example.com/token"
                          value={aiConnection.rest.url}
                          onChange={(e) => {
                            void updateAiRest({ url: e.target.value });
                          }}
                        />
                        <FormControl size="small" sx={{ width: 140 }}>
                          <Select
                            value={aiConnection.rest.method}
                            onChange={(e) => {
                              void updateAiRest({ method: e.target.value });
                            }}
                          >
                            <MenuItem value="GET">GET</MenuItem>
                            <MenuItem value="POST">POST</MenuItem>
                          </Select>
                        </FormControl>
                        <TextField
                          fullWidth
                          size="small"
                          label="Body"
                          multiline
                          minRows={5}
                          placeholder={`{\n  "client_id": "...",\n  "client_secret": "..."\n}`}
                          value={aiConnection.rest.requestBody}
                          onChange={(e) => {
                            void updateAiRest({ requestBody: e.target.value });
                          }}
                          sx={{ '& .MuiInputBase-input': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' } }}
                        />
                      </>
                    )}
                  </Box>
                </Box>
              )}

              <Box sx={{ mt: 1.5 }}>
                <Button
                  variant="contained"
                  startIcon={<TestConnectionIcon />}
                  onClick={() => showSnack('Test connection UI is ready. Logic will be added next.', 'info')}
                >
                  Test Connection
                </Button>
              </Box>
            </Box>
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

      <Snackbar
        open={snack.open}
        autoHideDuration={2200}
        onClose={() => setSnack((prev) => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snack.severity} onClose={() => setSnack((prev) => ({ ...prev, open: false }))}>
          {snack.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
