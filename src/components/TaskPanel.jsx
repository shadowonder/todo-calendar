/**
 * TaskPanel
 * Sub-component — left panel of CalendarPage showing todo list for the selected date.
 *
 * Props:
 *   selectedDate  {string}   YYYY-MM-DD
 *   onMutate      {function} optional callback after task mutations
 */
import React, { useEffect, useRef, useState } from 'react';
import { Box, Typography, List, ListItem, ListItemText, Divider, IconButton, TextField, InputAdornment, Chip, Tooltip, Tabs, Tab, Button } from '@mui/material';
import {
  AddCircleOutlineRounded as AddIcon,
  Delete as DeleteIcon,
  CheckCircle as CheckCircleIcon,
  RadioButtonUnchecked as UncheckedIcon,
  Search as SearchIcon,
  CalendarMonth as CalendarIcon,
  Edit as EditIcon,
  Star as StarIcon,
  StarBorder as StarBorderIcon,
  DragIndicator as DragIcon,
  SendRounded as SendIcon,
} from '@mui/icons-material';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTasks } from '../hooks/useTasks.js';
import { useAiChat } from '../hooks/useAiChat.js';
import AddTaskDialog from './AddTodoDialog.jsx';
import { useSettings } from '../context/SettingsContext.jsx';
import { resolveTaskColor } from '../constants/taskColors.js';
import TaskColorPopover from './TaskColorPopover.jsx';

const isElectron = () => typeof window !== 'undefined' && !!window.db;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function parseLocalDate(str) {
  return new Date(str + 'T00:00:00');
}

function truncateTitle(title, maxLength = 36) {
  if (typeof title !== 'string') return '';
  if (title.length <= maxLength) return title;
  return `${title.slice(0, maxLength)}...`;
}

/** Visual badge for task type and entry status */
function StatusChip({ task }) {
  const overdue = task.entry_status === 'overdue';
  const rolled = task.entry_status === 'rolled';

  if (overdue) return <Chip label="overdue" size="small" color="error" sx={{ height: 15, fontSize: 10, '& .MuiChip-label': { px: 0.6 } }} />;
  if (rolled) return <Chip label="rolled" size="small" color="warning" sx={{ height: 15, fontSize: 10, '& .MuiChip-label': { px: 0.6 } }} />;

  const typeColors = { one_day: 'default', due_date: 'warning', future: 'info', regular: undefined };
  const typeLabels = { one_day: 'one-day', due_date: 'due', future: 'future', regular: null };
  const label = typeLabels[task.task_type];
  if (!label) return null;
  return (
    <Chip
      label={label}
      size="small"
      color={typeColors[task.task_type]}
      variant="outlined"
      sx={{ height: 15, fontSize: 10, '& .MuiChip-label': { px: 0.6 } }}
    />
  );
}

/** Sortable task row wrapper */
function SortableTaskItem({ task, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  return (
    <Box ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}>
      {children({ dragHandleProps: { ...attributes, ...listeners } })}
    </Box>
  );
}

function OverflowTooltipText({ text }) {
  const textRef = useRef(null);
  const [isOverflowed, setIsOverflowed] = useState(false);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;

    const measureOverflow = () => {
      setIsOverflowed(el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
    };

    measureOverflow();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measureOverflow);
      return () => window.removeEventListener('resize', measureOverflow);
    }

    const observer = new ResizeObserver(measureOverflow);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);

  return (
    <Tooltip title={text || ''} disableHoverListener={!isOverflowed || !text?.trim()} placement="top" arrow>
      <Typography
        ref={textRef}
        variant="caption"
        color="text.secondary"
        sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', mb: 0.3 }}
      >
        {text}
      </Typography>
    </Tooltip>
  );
}

export default function TaskPanel({ selectedDate, onMutate }) {
  const { tasks, createTask, setDone, deleteTask, editTask, updateColor, togglePrioritized, reorderTask } = useTasks(selectedDate);
  const { defaultTaskType } = useSettings();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  // Color popover state: { anchorEl, taskId }
  const [colorPopover, setColorPopover] = useState({ anchorEl: null, taskId: null });
  const [activeTab, setActiveTab] = useState(0); // 0=Chat, 1=Tasks
  const [chatInput, setChatInput] = useState('');
  const { chatMessages, chatSending, providerLabel, sendMessage } = useAiChat({ selectedDate, tasks });
  const chatBottomRef = useRef(null);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chatMessages, activeTab]);

  const sendChat = async () => {
    const text = chatInput.trim();
    if (!text || chatSending) return;
    setChatInput('');
    await sendMessage(text);
  };

  // ── Search ────────────────────────────────────────────────────────────────

  const handleSearch = async (q) => {
    setSearchQuery(q);
    if (!q.trim()) {
      setSearchResults(null);
      return;
    }
    if (isElectron()) setSearchResults(await window.db.tasks.search(q));
  };

  // ── Add task ──────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditingTask(null);
    setDialogOpen(true);
  };
  const openEdit = (task) => {
    setEditingTask(task);
    setDialogOpen(true);
  };
  const closeDialog = () => {
    setDialogOpen(false);
    setEditingTask(null);
  };

  const handleAdd = async (fields) => {
    await createTask(fields);
    closeDialog();
    onMutate?.();
  };
  const handleEdit = async (id, fields) => {
    await editTask(id, fields);
    closeDialog();
    onMutate?.();
  };
  const handleDelete = async (id) => {
    await deleteTask(id);
    onMutate?.();
  };

  const displayTasks = (searchResults !== null ? searchResults : tasks).slice().sort((a, b) => {
    const ar = a.entry_status === 'rolled' ? 1 : 0;
    const br = b.entry_status === 'rolled' ? 1 : 0;
    if (ar !== br) return br - ar; // rolled tasks always on top

    const so = (a.sort_order ?? 0) - (b.sort_order ?? 0); // manual order
    if (so !== 0) return so;

    const ap = a.prioritized ?? 0;
    const bp = b.prioritized ?? 0;
    if (ap !== bp) return bp - ap;

    return (a.id ?? 0) - (b.id ?? 0);
  });

  const handleDragEnd = async ({ active, over }) => {
    if (!over || active.id === over.id) return;
    if (searchResults !== null) return;

    const oldIdx = displayTasks.findIndex((t) => t.id === active.id);
    const newIdx = displayTasks.findIndex((t) => t.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;

    const activeTask = displayTasks[oldIdx];
    const overTask = displayTasks[newIdx];
    const activeIsRolled = activeTask.entry_status === 'rolled';
    const overIsRolled = overTask.entry_status === 'rolled';

    // Keep groups separated: rolled and normal reorder independently.
    if (activeIsRolled !== overIsRolled) return;

    const groupTasks = displayTasks.filter((t) => (t.entry_status === 'rolled') === activeIsRolled);
    const oldGroupIdx = groupTasks.findIndex((t) => t.id === active.id);
    const newGroupIdx = groupTasks.findIndex((t) => t.id === over.id);
    if (oldGroupIdx === -1 || newGroupIdx === -1) return;

    const reorderedGroup = arrayMove(groupTasks, oldGroupIdx, newGroupIdx);
    await reorderTask(reorderedGroup, activeIsRolled ? 'rolled' : 'normal');
    onMutate?.();
  };

  // ── Header label ──────────────────────────────────────────────────────────
  const d = parseLocalDate(selectedDate);
  const headerLabel = `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  const popoverTask = displayTasks.find((t) => t.id === colorPopover.taskId) ?? null;

  return (
    <Box
      sx={{
        width: 320,
        minWidth: 280,
        borderRight: 1,
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper',
        height: '100%',
      }}
    >
      <Tabs
        value={activeTab}
        onChange={(_, v) => setActiveTab(v)}
        variant="fullWidth"
        sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 40 }}
      >
        <Tab label="Chat" sx={{ minHeight: 40, fontSize: 12 }} />
        <Tab label="Tasks" sx={{ minHeight: 40, fontSize: 12 }} />
      </Tabs>

      {activeTab === 0 && (
        <>
          <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
            <Typography variant="subtitle2" fontWeight={700}>
              AI Chat
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Provider: {providerLabel}
            </Typography>
          </Box>

          <Box sx={{ flexGrow: 1, overflow: 'auto', px: 1.5, py: 1.2, display: 'flex', flexDirection: 'column', gap: 1 }}>
            {chatMessages.map((m) => (
              <Box
                key={m.id}
                sx={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '88%',
                  px: 1.1,
                  py: 0.8,
                  borderRadius: 1,
                  border: 1,
                  borderColor: 'divider',
                  bgcolor: m.role === 'user' ? 'primary.main' : 'action.hover',
                }}
              >
                <Typography
                  variant="body2"
                  sx={{ whiteSpace: 'pre-wrap', color: m.role === 'user' ? 'primary.contrastText' : 'text.primary', fontSize: 12.5 }}
                >
                  {m.text}
                </Typography>
              </Box>
            ))}
            {chatSending && (
              <Typography variant="caption" color="text.secondary" sx={{ px: 0.5 }}>
                AI is typing...
              </Typography>
            )}
            <Box ref={chatBottomRef} />
          </Box>

          <Divider />
          <Box sx={{ p: 1.2 }}>
            <TextField
              fullWidth
              multiline
              minRows={2}
              maxRows={5}
              size="small"
              placeholder="Type a message..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendChat();
                }
              }}
            />
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 0.8 }}>
              <Button size="small" variant="contained" onClick={sendChat} disabled={!chatInput.trim() || chatSending} startIcon={<SendIcon sx={{ fontSize: 14 }} />}>
                Send
              </Button>
            </Box>
          </Box>
        </>
      )}

      {activeTab === 1 && (
        <>
          {/* Search bar */}
          <Box sx={{ px: 1.5, pt: 1.5, pb: 0.5 }}>
            <TextField
              fullWidth
              size="small"
              placeholder="Search tasks…"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />
          </Box>

          {/* Panel header */}
          <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box>
              <Typography variant="subtitle1" fontWeight={700}>
                {searchResults !== null ? `Results (${searchResults.length})` : headerLabel}
              </Typography>
              {searchResults === null && (
                <Typography variant="caption" color="text.secondary">
                  {tasks.length} task{tasks.length !== 1 ? 's' : ''}
                </Typography>
              )}
            </Box>
            {searchResults === null && (
              <IconButton size="small" color="primary" onClick={openCreate}>
                <AddIcon />
              </IconButton>
            )}
          </Box>

          {/* Task list */}
          <List sx={{ flexGrow: 1, overflow: 'auto', py: 0 }}>
            {displayTasks.length === 0 && (
              <Box sx={{ px: 2, py: 5, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  {searchResults !== null ? 'No results found' : 'No tasks for this day'}
                </Typography>
                {searchResults === null && (
                  <Typography variant="caption" color="text.secondary">
                    Click + to add one
                  </Typography>
                )}
              </Box>
            )}

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={displayTasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                {displayTasks.map((task, i) => {
                  const isDone = task.done === 1 || task.entry_status === 'done';
                  const isOverdue = task.entry_status === 'overdue';
                  const isPriority = task.prioritized === 1;
                  const customColor = task.color ? resolveTaskColor(task.color) : null;
                  const effectiveColor = customColor ?? resolveTaskColor();
                  const truncatedTitle = truncateTitle(task.title);
                  const isTitleTruncated = truncatedTitle !== (task.title || '');

                  return (
                    <SortableTaskItem key={task.id} task={task}>
                      {({ dragHandleProps }) => (
                        <>
                          {i > 0 && <Divider />}
                          <ListItem
                            alignItems="flex-start"
                            secondaryAction={
                              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                <IconButton
                                  size="small"
                                  onClick={() => openEdit(task)}
                                  sx={{ color: 'text.disabled', '&:hover': { color: 'primary.main' }, p: 0.4 }}
                                >
                                  <EditIcon sx={{ fontSize: 15 }} />
                                </IconButton>
                                <IconButton
                                  size="small"
                                  onClick={() => handleDelete(task.id)}
                                  sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' }, p: 0.4 }}
                                >
                                  <DeleteIcon sx={{ fontSize: 15 }} />
                                </IconButton>
                              </Box>
                            }
                            sx={{
                              pr: 5.5,
                              py: 0,
                              pl: 0,
                              bgcolor: isPriority ? 'rgba(251,191,36,0.08)' : isOverdue ? 'rgba(248,113,113,0.07)' : 'transparent',
                              borderLeft: isPriority ? '3px solid' : '3px solid transparent',
                              borderColor: isPriority ? 'warning.main' : 'transparent',
                              display: 'flex',
                              alignItems: 'stretch',
                            }}
                          >
                            {/* Drag handle — full row height */}
                            <Box
                              {...dragHandleProps}
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: 28,
                                flexShrink: 0,
                                alignSelf: 'stretch',
                                cursor: 'grab',
                                color: 'text.disabled',
                                '&:hover': { color: 'text.secondary', bgcolor: 'action.hover' },
                                '&:active': { cursor: 'grabbing' },
                              }}
                            >
                              <DragIcon sx={{ fontSize: 18 }} />
                            </Box>

                            {/* Row content */}
                            <Box sx={{ display: 'flex', alignItems: 'flex-start', flex: 1, py: 1 }}>
                              {/* Done toggle + prioritized toggle + color button stacked */}
                              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mr: 1, mt: 0.3, gap: 0.5, flexShrink: 0 }}>
                                <IconButton
                                  size="small"
                                  onClick={() => {
                                    setDone(task);
                                    onMutate?.();
                                  }}
                                  sx={{ p: 0, color: isDone ? 'success.main' : 'text.disabled' }}
                                >
                                  {isDone ? <CheckCircleIcon fontSize="small" /> : <UncheckedIcon fontSize="small" />}
                                </IconButton>

                                <Tooltip title={isPriority ? 'Deprioritize' : 'Mark prioritized'} placement="right">
                                  <IconButton
                                    size="small"
                                    onClick={async () => {
                                      await togglePrioritized(task);
                                      onMutate?.();
                                    }}
                                    sx={{ p: 0, color: isPriority ? 'warning.main' : 'text.disabled' }}
                                  >
                                    {isPriority ? <StarIcon sx={{ fontSize: 14 }} /> : <StarBorderIcon sx={{ fontSize: 14 }} />}
                                  </IconButton>
                                </Tooltip>

                                {/* Color square button */}
                                <Tooltip title={customColor ? customColor.label : 'Default (Blue)'} placement="right">
                                  <Box
                                    onClick={(e) => setColorPopover({ anchorEl: e.currentTarget, taskId: task.id })}
                                    sx={{
                                      width: 12,
                                      height: 12,
                                      borderRadius: 0.4,
                                      bgcolor: effectiveColor.bg,
                                      border: '1.5px solid',
                                      borderColor: effectiveColor.text,
                                      cursor: 'pointer',
                                      transition: 'transform 0.1s, box-shadow 0.1s',
                                      '&:hover': { transform: 'scale(1.3)', boxShadow: 2 },
                                    }}
                                  />
                                </Tooltip>
                              </Box>

                              <ListItemText
                                disableTypography
                                primary={
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                                    {isPriority && <StarIcon sx={{ fontSize: 13, color: 'warning.main', flexShrink: 0 }} />}
                                    <Tooltip title={task.title || ''} disableHoverListener={!isTitleTruncated} placement="top" arrow>
                                      <Typography
                                        variant="body2"
                                        fontWeight={isPriority ? 700 : 600}
                                        sx={{
                                          flex: 1,
                                          minWidth: 0,
                                          display: 'block',
                                          whiteSpace: 'nowrap',
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                          textDecoration: isDone ? 'line-through' : 'none',
                                          color: isDone
                                            ? 'text.disabled'
                                            : customColor
                                              ? customColor.text
                                              : isOverdue
                                                ? 'error.main'
                                                : isPriority
                                                  ? 'warning.dark'
                                                  : 'text.primary',
                                        }}
                                      >
                                        {truncatedTitle}
                                      </Typography>
                                    </Tooltip>
                                    <Box sx={{ flexShrink: 0 }}>
                                      <StatusChip task={task} />
                                    </Box>
                                  </Box>
                                }
                                secondary={
                                  <Box sx={{ mt: 0.3 }}>
                                    {task.description ? <OverflowTooltipText text={task.description} /> : null}
                                    {(task.due_date || task.end_date) && (
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, mb: 0.3 }}>
                                        <CalendarIcon sx={{ fontSize: 11, color: 'text.disabled' }} />
                                        <Typography variant="caption" color={isOverdue ? 'error.main' : 'text.secondary'}>
                                          {task.task_type === 'due_date' ? `Due: ${task.due_date}` : `${task.start_date} → ${task.end_date}`}
                                        </Typography>
                                      </Box>
                                    )}
                                    {searchResults !== null && (
                                      <Typography variant="caption" color="text.secondary">
                                        Created on {task.origin_date}
                                      </Typography>
                                    )}
                                    {task.tags ? (
                                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.4, mt: 0.3 }}>
                                        {task.tags
                                          .split(',')
                                          .filter(Boolean)
                                          .map((t) => (
                                            <Chip
                                              key={t}
                                              label={t.trim()}
                                              size="small"
                                              variant="outlined"
                                              color="primary"
                                              sx={{ height: 14, fontSize: 10, '& .MuiChip-label': { px: 0.5 } }}
                                            />
                                          ))}
                                      </Box>
                                    ) : null}
                                  </Box>
                                }
                              />
                            </Box>
                          </ListItem>
                        </>
                      )}
                    </SortableTaskItem>
                  );
                })}
              </SortableContext>
            </DndContext>
          </List>
        </>
      )}

      {/* Add Task Dialog */}
      <AddTaskDialog
        open={dialogOpen}
        anchorDate={selectedDate}
        task={editingTask}
        defaultTaskType={defaultTaskType}
        onAdd={handleAdd}
        onEdit={handleEdit}
        onClose={closeDialog}
      />

      {/* Color Popover */}
      <TaskColorPopover
        anchorEl={colorPopover.anchorEl}
        currentColor={popoverTask?.color ?? null}
        onClose={() => setColorPopover({ anchorEl: null, taskId: null })}
        onSelect={async (colorId) => {
          if (colorPopover.taskId == null) return;
          await updateColor(colorPopover.taskId, colorId);
          onMutate?.();
        }}
      />
    </Box>
  );
}
