import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Typography, Paper, Button, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import TaskPanel from '../components/TaskPanel.jsx';
import { getMemoryGridTasks } from '../hooks/useTasks.js';
import { resolveTaskColor } from '../constants/taskColors.js';
import { AiPreviewProvider, useAiPreview } from '../context/AiPreviewContext.jsx';
import { derivePreviewTasksMap } from '../ai/preview/derivePreviewTasksMap.js';
import { WRITE_PROCESSORS } from '../ai/actions/actionCatalog.js';
import { validateActionArgsWithZod } from '../ai/actions/actionValidation.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const isElectron = () => typeof window !== 'undefined' && !!window.db;

function fmt(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function todayStr() {
  const t = new Date();
  return fmt(t.getFullYear(), t.getMonth(), t.getDate());
}

function truncateTitle(title, maxLength = 18) {
  if (typeof title !== 'string') return '';
  if (title.length <= maxLength) return title;
  return `${title.slice(0, maxLength)}...`;
}

function compareTaskIds(aId, bId) {
  const aNum = Number(aId);
  const bNum = Number(bId);
  const aIsNum = Number.isFinite(aNum);
  const bIsNum = Number.isFinite(bNum);
  if (aIsNum && bIsNum) return aNum - bNum;
  if (aIsNum) return -1;
  if (bIsNum) return 1;
  return String(aId ?? '').localeCompare(String(bId ?? ''));
}

function getPreviewVisualStyle(previewStatus, theme) {
  if (previewStatus === 'created' || previewStatus === 'movedTo') {
    return {
      borderColor: theme.palette.success.main,
      bgColor: alpha(theme.palette.success.main, 0.16),
      textColor: theme.palette.success.dark,
      forceLineThrough: false,
      opacity: 1,
    };
  }
  if (previewStatus === 'updated') {
    return {
      borderColor: theme.palette.warning.main,
      bgColor: alpha(theme.palette.warning.main, 0.18),
      textColor: theme.palette.warning.dark,
      forceLineThrough: false,
      opacity: 1,
    };
  }
  if (previewStatus === 'deleted' || previewStatus === 'movedFrom') {
    return {
      borderColor: theme.palette.error.main,
      bgColor: alpha(theme.palette.error.main, 0.14),
      textColor: theme.palette.error.dark,
      forceLineThrough: true,
      opacity: 0.85,
    };
  }
  return null;
}

function getPlanActionPalette(theme) {
  const isDark = theme.palette.mode === 'dark';

  if (isDark) {
    return {
      cancelBg: '#212529',
      cancelBorder: '#495057',
      cancelText: '#c1c7cd',
      cancelHoverBg: '#343a40',
      cancelHoverBorder: '#868e96',
      cancelHoverText: '#f2f4f8',
      confirmBg: '#0f62fe',
      confirmText: '#ffffff',
      confirmHoverBg: '#228be6',
      confirmShadow: '0 10px 22px rgba(15, 98, 254, 0.34)',
      confirmHoverShadow: '0 12px 26px rgba(34, 139, 230, 0.4)',
    };
  }

  return {
    cancelBg: '#ffffff',
    cancelBorder: '#ced4da',
    cancelText: '#495057',
    cancelHoverBg: '#f8f9fa',
    cancelHoverBorder: '#adb5bd',
    cancelHoverText: '#212529',
    confirmBg: '#0f62fe',
    confirmText: '#ffffff',
    confirmHoverBg: '#1c7ed6',
    confirmShadow: '0 9px 18px rgba(15, 98, 254, 0.25)',
    confirmHoverShadow: '0 11px 22px rgba(28, 126, 214, 0.32)',
  };
}

function getTaskWriteApi() {
  const db = globalThis?.window?.db || globalThis?.db;
  const tasks = db?.tasks;
  if (!tasks) return null;

  return {
    create: (data) => tasks.create(data),
    update: (id, patch) => tasks.update(id, patch),
    setDone: (id, done, entryDate) => tasks.setDone(id, done, entryDate),
    delete: (id) => tasks.delete(id),
  };
}

async function applyStructuredWritePlan(plan) {
  if (!plan || plan.action !== 'write' || !Array.isArray(plan.actions) || plan.actions.length === 0) {
    return { applied: 0, skipped: true };
  }

  const validated = validateActionArgsWithZod(plan, {
    readProcessors: {},
    writeProcessors: WRITE_PROCESSORS,
  });

  if (!validated || validated.action !== 'write' || !Array.isArray(validated.actions) || validated.actions.length === 0) {
    return { applied: 0, skipped: true };
  }

  const api = getTaskWriteApi();
  if (!api) {
    throw new Error('Task write API is unavailable.');
  }

  let applied = 0;
  for (const action of validated.actions) {
    const methodName = typeof action?.method === 'string' ? action.method : '';
    const spec = WRITE_PROCESSORS[methodName];
    if (!spec || typeof spec.processor !== 'function') continue;

    const args = Array.isArray(action?.args) ? action.args : [];
    await spec.processor({ api, args });
    applied += 1;
  }

  return { applied, skipped: false };
}

function CalendarPageContent({ nativeChatStatus = { enabled: false, phase: 'idle', tier: '' } }) {
  const today = new Date();
  const theme = useTheme();
  const { structuredPlan, clearStructuredPlan } = useAiPreview();
  const showPlanActionButtons = Boolean(
    structuredPlan
    && typeof structuredPlan === 'object'
    && Object.keys(structuredPlan).length > 0
  );
  const planActionPalette = useMemo(() => getPlanActionPalette(theme), [theme]);
  const [isApplying, setIsApplying] = useState(false);
  const [tasksReloadNonce, setTasksReloadNonce] = useState(0);

  // view month (independent from selected date)
  const [current, setCurrent] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(todayStr());
  // gridTasksMap: { 'YYYY-MM-DD': [{ id, title, entry_status, done, prioritized }, ...] }
  const [gridTasksMap, setGridTasksMap] = useState({});

  const year = current.getFullYear();
  const month = current.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // prev month overflow
  const prevMonthDays = new Date(year, month, 0).getDate();

  // Build a flat 42-cell grid (6 rows × 7 cols) with { dateStr, day, overflow }
  const cells = [];
  // leading cells from prev month
  for (let i = 0; i < firstDay; i++) {
    const d = prevMonthDays - firstDay + 1 + i;
    const prevMonth = month - 1;
    const prevYear = prevMonth < 0 ? year - 1 : year;
    const pm = ((prevMonth % 12) + 12) % 12;
    cells.push({ dateStr: fmt(prevYear, pm, d), day: d, overflow: 'prev' });
  }
  // current month
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ dateStr: fmt(year, month, d), day: d, overflow: null });
  }
  // trailing cells from next month
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) {
    const nextMonth = month + 1;
    const nextYear = nextMonth > 11 ? year + 1 : year;
    const nm = nextMonth % 12;
    cells.push({ dateStr: fmt(nextYear, nm, d), day: d, overflow: 'next' });
  }

  // ── Load all tasks for the full 42-cell grid whenever month changes ──────
  const loadGridTasks = useCallback(async () => {
    if (!isElectron()) {
      // Browser / non-Electron fallback: read from in-memory store
      setGridTasksMap(getMemoryGridTasks(cells));
      return;
    }
    // cells are already computed above; first and last dateStr cover the full grid
    const startDate = cells[0].dateStr;
    const endDate = cells[cells.length - 1].dateStr;
    const map = await window.db.tasks.getGridTasks(startDate, endDate);
    setGridTasksMap(map);
  }, [year, month]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadGridTasks();
  }, [loadGridTasks]);

  const previewTasksMap = useMemo(
    () => derivePreviewTasksMap(gridTasksMap, structuredPlan, { devMode: import.meta.env.DEV }),
    [gridTasksMap, structuredPlan]
  );

  // ── Circle style / text colour helpers ───────────────────────────────────
  const getCircleStyle = (dateStr, overflow) => {
    const isSelected = dateStr === selectedDate;
    const isTodayDate = dateStr === todayStr();
    if (isSelected && isTodayDate) {
      return {
        bgcolor: 'primary.main',
        boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.light, 0.8)}`,
      };
    }
    if (isSelected) {
      return {
        bgcolor: 'primary.main',
        boxShadow: `0 2px 8px ${alpha(theme.palette.primary.main, 0.35)}`,
      };
    }
    if (isTodayDate) {
      return {
        bgcolor: alpha(theme.palette.primary.main, 0.08),
        border: `1.5px solid ${overflow ? theme.palette.text.disabled : theme.palette.primary.main}`,
      };
    }
    return { bgcolor: 'transparent' };
  };

  const getTextColor = (dateStr, overflow) => {
    const isSelected = dateStr === selectedDate;
    const isTodayDate = dateStr === todayStr();
    if (isSelected) return 'primary.contrastText';
    if (isTodayDate) return overflow ? 'text.disabled' : 'primary.main';
    return overflow ? 'text.disabled' : 'text.primary';
  };

  const goToToday = () => {
    setCurrent(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(todayStr());
  };

  const handleConfirmApply = async () => {
    if (isApplying) return;
    if (!structuredPlan || structuredPlan.action !== 'write') return;

    setIsApplying(true);
    try {
      await applyStructuredWritePlan(structuredPlan);
      await loadGridTasks();
      setTasksReloadNonce((prev) => prev + 1);
      clearStructuredPlan();
    } catch (error) {
      console.error('[AI Apply] Failed to apply structured plan:', error);
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <TaskPanel
        selectedDate={selectedDate}
        onMutate={loadGridTasks}
        nativeChatStatus={nativeChatStatus}
        tasksReloadNonce={tasksReloadNonce}
      />

      <Box sx={{ flexGrow: 1, p: 3, overflow: 'auto' }}>
        {/* Navigation — only changes view month, never selectedDate */}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 2 }}>
          <Button variant="outlined" size="small" onClick={() => setCurrent(new Date(year, month - 1, 1))}>
            {"<"}
          </Button>
          <Typography variant="h6" fontWeight={700} sx={{ minWidth: 180, textAlign: 'center' }}>
            {MONTHS[month]} {year}
          </Typography>
          <Button variant="outlined" size="small" onClick={() => setCurrent(new Date(year, month + 1, 1))}>
            {">"}
          </Button>
          <Button variant="outlined" size="small" onClick={goToToday}>
            Today
          </Button>
        </Box>

        <Paper elevation={0} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
          {/* Day headers (weekdays) */}
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider' }}>
            {DAYS.map((d) => (
              <Box key={d} sx={{ py: 1, textAlign: 'center' }}>
                <Typography variant="caption" fontWeight={700} color="text.secondary">
                  {d}
                </Typography>
              </Box>
            ))}
          </Box>

          {/* Date cells — 42 cells, overflow dates shown in gray */}
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)' }}>
            {cells.map(({ dateStr, day, overflow }, i) => {
              const isSelected = dateStr === selectedDate;
              const dayTasks = previewTasksMap[dateStr] ?? [];
              const sortedDayTasks = dayTasks.slice().sort((a, b) => {
                const so = (a.sort_order ?? 0) - (b.sort_order ?? 0);
                if (so !== 0) return so;

                const ap = a.prioritized ?? 0;
                const bp = b.prioritized ?? 0;
                if (ap !== bp) return bp - ap;

                return compareTaskIds(a.id, b.id);
              });
              return (
                <Box
                  key={i}
                  onClick={() => setSelectedDate(dateStr)}
                  sx={{
                    minHeight: 86,
                    p: 1,
                    borderRight: (i + 1) % 7 !== 0 ? 1 : 0,
                    borderBottom: i < 35 ? 1 : 0,
                    borderColor: 'divider',
                    cursor: 'pointer',
                    opacity: overflow ? 0.45 : 1,
                    bgcolor: isSelected ? 'action.selected' : 'transparent',
                    transition: 'background-color 0.12s',
                    '&:hover': { bgcolor: isSelected ? 'action.selected' : 'action.hover' },
                  }}
                >
                  {/* Date number circle */}
                  <Box
                    sx={{
                      width: 22,
                      height: 22,
                      borderRadius: 1.03,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      ...getCircleStyle(dateStr, overflow),
                    }}
                  >
                    <Typography
                      variant="caption"
                      fontWeight={dateStr === todayStr() || isSelected ? 700 : 400}
                      sx={{ color: getTextColor(dateStr, overflow), lineHeight: 1 }}
                    >
                      {day}
                    </Typography>
                  </Box>

                  {/* Task title pills */}
                  <Box sx={{ mt: 0.5, display: 'flex', flexDirection: 'column', gap: 0.3, minWidth: 0 }}>
                    {sortedDayTasks.slice(0, 3).map((task) => {
                      const isDone = task.done === 1 || task.entry_status === 'done';
                      const isOverdue = task.entry_status === 'overdue';
                      const isPinned = task.prioritized === 1;
                      const previewStatus = typeof task.previewStatus === 'string'
                        ? task.previewStatus
                        : 'unchanged';
                      const isPreviewModified = task.modified === true || previewStatus !== 'unchanged';
                      const previewStyle = getPreviewVisualStyle(previewStatus, theme);

                      // Resolve colors: custom > status-based fallback
                      const customColor = task.color ? resolveTaskColor(task.color) : null;
                      // Default (no explicit color) maps to blue palette entry
                      const resolvedColor = customColor ?? resolveTaskColor();
                      const pillBg = isDone
                        ? null // use MUI token below
                        : isOverdue
                          ? null
                          : isPinned && !customColor
                            ? null
                            : resolvedColor.bg;
                      const pillText = isDone ? null : isOverdue ? null : isPinned && !customColor ? null : resolvedColor.text;
                      // Border: always use a matching color — status pills get their own color too
                      const pillBorder = isDone
                        ? 'transparent'
                        : isOverdue
                          ? '#B91C1C' // red border for overdue
                          : isPinned && !customColor
                            ? '#B45309' // amber border for pinned-default
                            : resolvedColor.text;

                      const finalPillBg = previewStyle
                        ? previewStyle.bgColor
                        : (pillBg ?? (isDone ? 'action.disabledBackground' : isOverdue ? 'error.light' : 'warning.light'));
                      const finalPillBorder = previewStyle ? previewStyle.borderColor : pillBorder;
                      const finalPillText = previewStyle
                        ? previewStyle.textColor
                        : (pillText ?? (isDone ? 'text.disabled' : isOverdue ? 'error.contrastText' : 'warning.dark'));
                      const forceLineThrough = Boolean(previewStyle?.forceLineThrough);
                      const finalOpacity = previewStyle?.opacity ?? 1;
                      const previewKey = task.previewKey || `${String(task.id ?? 'task')}:${String(task.entry_date ?? dateStr)}`;

                      return (
                        <Box
                          key={previewKey}
                          sx={{
                            px: 0.6,
                            py: 0.1,
                            borderRadius: 0.8,
                            minWidth: 0,
                            overflow: 'hidden',
                            border: '1px solid',
                            borderColor: finalPillBorder,
                            borderStyle: isPreviewModified ? 'dashed' : 'solid',
                            bgcolor: finalPillBg,
                            opacity: finalOpacity,
                          }}
                        >
                          <Typography
                            variant="caption"
                            sx={{
                              fontSize: 10,
                              lineHeight: 1.4,
                              display: 'block',
                              width: '100%',
                              maxWidth: '100%',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              textDecoration: isDone || forceLineThrough ? 'line-through' : 'none',
                              color: finalPillText,
                            }}
                          >
                            {truncateTitle(task.title)}
                          </Typography>
                        </Box>
                      );
                    })}
                    {sortedDayTasks.length > 3 && (
                      <Typography variant="caption" sx={{ fontSize: 10, color: 'text.disabled', pl: 0.5 }}>
                        +{sortedDayTasks.length - 3} more
                      </Typography>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Paper>

        {showPlanActionButtons && (
          <Box
            sx={{
              mt: 1.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1,
            }}
          >
            <Typography
              variant="body2"
              sx={{
                color: 'text.secondary',
                fontWeight: 600,
                letterSpacing: 0.1,
                pl: 0.2,
              }}
            >
              Apply above changes?
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Button
              variant="contained"
              size="small"
              disableElevation
              sx={{
                minWidth: 96,
                px: 1.6,
                borderRadius: 999,
                textTransform: 'none',
                fontWeight: 700,
                letterSpacing: 0.1,
                bgcolor: planActionPalette.cancelBg,
                color: planActionPalette.cancelText,
                border: '1px solid',
                borderColor: planActionPalette.cancelBorder,
                boxShadow: 'none',
                '&:hover': {
                  bgcolor: planActionPalette.cancelHoverBg,
                  color: planActionPalette.cancelHoverText,
                  borderColor: planActionPalette.cancelHoverBorder,
                  boxShadow: 'none',
                },
              }}
              onClick={clearStructuredPlan}
              disabled={isApplying}
            >
              Cancel
            </Button>
            <Button
              variant="contained"
              size="small"
              disableElevation
              sx={{
                minWidth: 106,
                px: 1.95,
                borderRadius: 999,
                textTransform: 'none',
                fontWeight: 800,
                letterSpacing: 0.18,
                color: planActionPalette.confirmText,
                bgcolor: planActionPalette.confirmBg,
                boxShadow: planActionPalette.confirmShadow,
                transition: 'all 0.16s ease',
                '&:hover': {
                  bgcolor: planActionPalette.confirmHoverBg,
                  boxShadow: planActionPalette.confirmHoverShadow,
                  transform: 'translateY(-1px)',
                },
              }}
              onClick={handleConfirmApply}
              disabled={isApplying}
            >
              {isApplying ? 'Applying...' : 'Confirm'}
            </Button>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}

export default function CalendarPage(props) {
  return (
    <AiPreviewProvider>
      <CalendarPageContent {...props} />
    </AiPreviewProvider>
  );
}
