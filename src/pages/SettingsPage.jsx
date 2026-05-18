import React, { useMemo, useState } from 'react';
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
  Collapse,
  TextField,
  Button,
} from '@mui/material';
import {
  Settings as SettingsIcon,
  NetworkCheckRounded as TestConnectionIcon,
} from '@mui/icons-material';
import { useColorMode } from '../context/ThemeContext.jsx';
import { useSettings } from '../context/SettingsContext.jsx';
import {
  NATIVE_MODEL_TIERS,
  getNativeRuntimeHints,
  resolveNativeModelSelection,
  getTierLabel,
} from '../ai/nativeModels.js';

const TAB_TO_TYPE = ['apikey', 'restapi'];
const TYPE_TO_TAB = { apikey: 0, restapi: 1 };
const SECTION_TITLE_SX = { textTransform: 'uppercase', letterSpacing: 1 };
const MONOSPACE_INPUT_SX = {
  '& .MuiInputBase-input': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  },
};

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
    setAiModelVersion,
    setAiModelHeaders,
    setAiAzureEnabled,
    setAiConnectionType,
    updateAiNative,
    updateAiApiKey,
    updateAiRest,
  } = useSettings();
  const [snack, setSnack] = useState({ open: false, message: '', severity: 'success' });
  const [showModelHeaders, setShowModelHeaders] = useState(false);

  const showSnack = (message, severity = 'success') => {
    setSnack({ open: true, message, severity });
  };

  const connectionTab = TYPE_TO_TAB[activeExternalType] ?? 0;
  const azureEnabled = aiConnection.azureEnabled === true;
  const nativeHints = useMemo(() => getNativeRuntimeHints(), []);
  const nativeSelection = useMemo(
    () => resolveNativeModelSelection(aiConnection.native, nativeHints),
    [aiConnection.native, nativeHints]
  );
  const nativeTierLabel = getTierLabel(nativeSelection.selectedTier);
  const nativeStrategyValue = (() => {
    const tier = typeof aiConnection.native.modelTier === 'string' ? aiConnection.native.modelTier : 'auto';
    return tier === 'auto' || NATIVE_MODEL_TIERS.some((item) => item.id === tier) ? tier : 'auto';
  })();

  return (
    <Box
      sx={{
        p: 3,
        // Responsive width: fill small screens, grow with page width, but stay within min/max bounds.
        width: 'min(100%, clamp(680px, 82vw, 980px))',
      }}
    >
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
                <Typography variant="caption" fontWeight={700} color="text.secondary" sx={SECTION_TITLE_SX}>
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
                <Typography variant="caption" fontWeight={700} color="text.secondary" sx={SECTION_TITLE_SX}>
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

              {isNativeMode && (
                <Box
                  sx={{
                    mt: 1.25,
                    p: 1.25,
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1.5,
                    bgcolor: 'background.paper',
                  }}
                >
                  <Typography variant="body2" fontWeight={700}>
                    Native Model Strategy
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Device memory: {nativeHints.deviceMemoryGB ? `~${nativeHints.deviceMemoryGB} GB` : 'unknown'}
                    {'  '}| CPU threads: {nativeHints.hardwareConcurrency || 'unknown'}
                  </Typography>

                  <FormControl size="small" fullWidth sx={{ mt: 1.2 }}>
                    <Select
                      value={nativeStrategyValue}
                      onChange={(e) => {
                        void updateAiNative({ modelTier: e.target.value });
                      }}
                    >
                      <MenuItem value="auto">Auto (Recommended)</MenuItem>
                      {NATIVE_MODEL_TIERS.map((tier) => (
                        <MenuItem key={tier.id} value={tier.id}>
                          {tier.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1.1, display: 'block' }}>
                    {`Current strategy: ${nativeTierLabel}`}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.35, display: 'block' }}>
                    {'Note: automatic downgrade is conservative. We only try Balanced when High fails to load; other profiles do not auto-downgrade unless you switch them manually.'}
                  </Typography>
                </Box>
              )}

              {!isNativeMode && (
                <>
                  <TextField
                    fullWidth
                    size="small"
                    label="Model URL"
                    placeholder={azureEnabled ? 'https://your-resource.openai.azure.com/openai/deployments/your-deployment' : 'https://api.example.com/v1/responses'}
                    value={aiConnection.modelUrl}
                    onChange={(e) => {
                      void setAiModelUrl(e.target.value);
                    }}
                    sx={{ mt: 1.2 }}
                  />

                  <TextField
                    fullWidth
                    size="small"
                    label={azureEnabled ? 'API Version' : 'Model Version'}
                    placeholder={azureEnabled ? '2024-10-21' : 'gpt-4.1-mini'}
                    value={aiConnection.modelVersion}
                    onChange={(e) => {
                      void setAiModelVersion(e.target.value);
                    }}
                    sx={{ mt: 1.2 }}
                  />

                  <Box
                    sx={{
                      mt: 1.2,
                      px: 1.25,
                      py: 1,
                      border: 1,
                      borderColor: 'divider',
                      borderRadius: 1.25,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 1.5,
                    }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={700}>
                        Use Azure OpenAI
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {azureEnabled
                          ? 'Model Version field is treated as Azure API version.'
                          : 'Turn on when your API key and endpoint are for Azure OpenAI.'}
                      </Typography>
                    </Box>
                    <Switch
                      size="small"
                      checked={azureEnabled}
                      onChange={(e) => {
                        void setAiAzureEnabled(e.target.checked);
                      }}
                    />
                  </Box>

                  <Box sx={{ mt: 0.8 }}>
                    <Button
                      size="small"
                      variant="text"
                      onClick={() => setShowModelHeaders((prev) => !prev)}
                    >
                      {showModelHeaders ? 'Hide Model Headers' : 'Show Model Headers (Advanced)'}
                    </Button>

                    <Collapse in={showModelHeaders}>
                      <TextField
                        fullWidth
                        size="small"
                        label="Model Headers"
                        multiline
                        minRows={3}
                        placeholder={`{\n  "projectId": "your-project-id"\n}`}
                        value={aiConnection.modelHeaders}
                        onChange={(e) => {
                          void setAiModelHeaders(e.target.value);
                        }}
                        sx={{ mt: 0.8, ...MONOSPACE_INPUT_SX }}
                      />
                    </Collapse>
                  </Box>

                  <Box sx={{ mt: 1.5, border: 1, borderColor: 'divider', borderRadius: 1.5, overflow: 'hidden' }}>
                    <Tabs
                      value={connectionTab}
                      onChange={(_, v) => {
                        const nextType = TAB_TO_TYPE[v] || 'apikey';
                        void setAiConnectionType(nextType);
                      }}
                      variant="fullWidth"
                      sx={{ borderBottom: 1, borderColor: 'divider' }}
                    >
                      <Tab label="API Key" />
                      <Tab label="REST API" />
                    </Tabs>

                    <Box sx={{ p: 1.5, display: 'grid', gap: 1.2 }}>
                      {connectionTab === 0 && (
                        <TextField
                          fullWidth
                          size="small"
                          type="password"
                          label={azureEnabled ? 'Azure API Key' : 'API Key'}
                          placeholder={azureEnabled ? 'azure-api-key-...' : 'sk-...'}
                          value={aiConnection.apiKey.key}
                          onChange={(e) => {
                            void updateAiApiKey({ key: e.target.value });
                          }}
                        />
                      )}

                      {connectionTab === 1 && (
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
                            label="Headers"
                            multiline
                            minRows={3}
                            placeholder={`{\n  "Content-Type": "application/json"\n}`}
                            value={aiConnection.rest.headers}
                            onChange={(e) => {
                              void updateAiRest({ headers: e.target.value });
                            }}
                            sx={MONOSPACE_INPUT_SX}
                          />
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
                            sx={MONOSPACE_INPUT_SX}
                          />
                          <TextField
                            fullWidth
                            size="small"
                            label="Response Field"
                            placeholder="api.response[0].token"
                            value={aiConnection.rest.responseField}
                            onChange={(e) => {
                              void updateAiRest({ responseField: e.target.value });
                            }}
                          />
                        </>
                      )}
                    </Box>
                  </Box>
                </>
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
                <Typography variant="caption" fontWeight={700} color="text.secondary" sx={SECTION_TITLE_SX}>
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
