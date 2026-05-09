/**
 * AddTaskDialog — create or edit a task.
 *
 * Props:
 *   open        {boolean}
 *   anchorDate  {string}   YYYY-MM-DD  — the date the user is viewing
 *   task        {object|null} — if provided, we're in edit mode
 *   onAdd       {function}  (fields) => void   — create mode
 *   onEdit      {function}  (id, fields) => void — edit mode
 *   onClose     {function}
 */
import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Chip,
  Typography,
  IconButton,
  Collapse,
  Divider,
  FormControlLabel,
  Checkbox,
} from '@mui/material';
import {
  Add as AddIcon,
  Close as CloseIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Star as StarIcon,
  Check as CheckIcon,
} from '@mui/icons-material';
import { TASK_COLORS } from '../constants/taskColors.js';

// ── Task mode options ─────────────────────────────────────────────────────────
const MODES = [
  { value: 'carry_over', label: 'Carry Over', desc: 'Incomplete past tasks also show in today list as rolled' },
  { value: 'fixed_day', label: 'Fixed Day', desc: 'Only appears on the selected date' },
  { value: 'date_range', label: 'Date Range', desc: 'Visible across a range of dates' },
];

// Map UI mode → DB task_type
function modeToTaskType(mode, hasDueDate) {
  if (mode === 'carry_over') return hasDueDate ? 'due_date' : 'regular';
  if (mode === 'fixed_day') return 'one_day';
  return 'future';
}

// Map DB task_type → UI mode
function taskTypeToMode(task_type) {
  if (task_type === 'one_day') return 'fixed_day';
  if (task_type === 'future') return 'date_range';
  return 'carry_over'; // regular + due_date both map to carry_over
}

export default function AddTaskDialog({ open, anchorDate, task, onAdd, onEdit, onClose, defaultTaskType = 'carry_over' }) {
  const isEdit = !!task;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState('carry_over');
  const [date, setDate] = useState(''); // start date / fixed day
  const [endDate, setEndDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [prioritized, setPrioritized] = useState(false);
  const [color, setColor] = useState(null); // null means default

  // Populate form when opening
  useEffect(() => {
    if (!open) return;
    if (isEdit && task) {
      setTitle(task.title || '');
      setDescription(task.description || '');
      setMode(taskTypeToMode(task.task_type));
      setDate(task.start_date || anchorDate);
      setEndDate(task.end_date || '');
      setDueDate(task.due_date || '');
      setTags(task.tags ? task.tags.split(',').filter(Boolean) : []);
      setShowAdvanced(!!task.tags);
      setPrioritized(!!task.prioritized);
      setColor(task.color || null);
    } else {
      setTitle('');
      setDescription('');
      setMode(defaultTaskType || 'carry_over');
      setDate(anchorDate || '');
      setEndDate('');
      setDueDate('');
      setTagInput('');
      setTags([]);
      setShowAdvanced(false);
      setPrioritized(false);
      setColor(null);
    }
  }, [open, isEdit, task, anchorDate, defaultTaskType]);

  const addTag = () => {
    const t = tagInput.trim().toLowerCase().replace(/\s+/g, '-');
    if (t && !tags.includes(t)) setTags((p) => [...p, t]);
    setTagInput('');
  };

  const isValid = () => {
    if (!title.trim()) return false;
    if (mode === 'date_range' && (!date || !endDate)) return false;
    return true;
  };

  const buildFields = () => ({
    title: title.trim(),
    description: description.trim(),
    tags: tags.join(','),
    task_type: modeToTaskType(mode, !!dueDate),
    start_date: date || anchorDate,
    end_date: mode === 'date_range' ? endDate || null : null,
    due_date: mode === 'carry_over' ? dueDate || null : null,
    prioritized: prioritized ? 1 : 0,
    color: color || null,
  });

  const handleSubmit = () => {
    if (!isValid()) return;
    if (isEdit) onEdit(task.id, buildFields());
    else onAdd(buildFields());
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
        <Typography fontWeight={700}>{isEdit ? 'Edit Task' : 'New Task'}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="caption" color="text.secondary">
            {anchorDate}
          </Typography>
          <IconButton size="small" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '20px !important' }}>
        {/* Title */}
        <TextField
          autoFocus
          fullWidth
          required
          label="Title"
          size="small"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSubmit()}
        />

        {/* Description — always visible, below title */}
        <TextField
          fullWidth
          multiline
          rows={2}
          label="Description"
          size="small"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        {/* Priority checkbox */}
        <FormControlLabel
          control={
            <Checkbox
              checked={prioritized}
              onChange={(e) => setPrioritized(e.target.checked)}
              size="small"
              icon={<StarIcon fontSize="small" sx={{ color: 'text.disabled' }} />}
              checkedIcon={<StarIcon fontSize="small" sx={{ color: 'warning.main' }} />}
            />
          }
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography variant="body2" fontWeight={prioritized ? 700 : 400} sx={{ color: prioritized ? 'warning.main' : 'text.secondary' }}>
                Prioritized
              </Typography>
              {prioritized && (
                <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                  — mark this high priority
                </Typography>
              )}
            </Box>
          }
          sx={{ mx: 0, mt: -1 }}
        />

        {/* Date field for date_range (carry_over uses anchor date) */}
        {mode === 'date_range' && (
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.4, ml: 0.2 }}>
                On Date
              </Typography>
              <TextField
                fullWidth
                required
                size="small"
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  if (endDate && e.target.value && endDate < e.target.value) setEndDate('');
                }}
              />
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.4, ml: 0.2 }}>
                End date
              </Typography>
              <TextField
                fullWidth
                required
                size="small"
                type="date"
                inputProps={{ min: date || undefined }}
                value={endDate}
                onChange={(e) => {
                  const val = e.target.value;
                  if (date && val && val < date) setEndDate(date);
                  else setEndDate(val);
                }}
              />
            </Box>
          </Box>
        )}

        {/* Advanced section (collapsed by default) */}
        <Box>
          <Divider>
            <Button
              size="small"
              variant="text"
              color="inherit"
              endIcon={showAdvanced ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
              onClick={() => setShowAdvanced((p) => !p)}
              sx={{ color: 'text.secondary', fontSize: 11, px: 1, minHeight: 'unset', textTransform: 'none' }}
            >
              {showAdvanced ? 'Hide' : 'More options'}
            </Button>
          </Divider>

          <Collapse in={showAdvanced}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 1.5 }}>
              {/* Schedule type */}
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                  Schedule
                </Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  {MODES.map(({ value, label, desc }) => (
                    <Box
                      key={value}
                      onClick={() => setMode(value)}
                      sx={{
                        flex: 1,
                        py: 0.8,
                        px: 0.5,
                        borderRadius: 1.5,
                        textAlign: 'center',
                        cursor: 'pointer',
                        border: 2,
                        borderColor: mode === value ? 'primary.main' : 'divider',
                        bgcolor: mode === value ? 'action.selected' : 'transparent',
                        transition: 'all 0.15s',
                        '&:hover': { borderColor: 'primary.main' },
                      }}
                    >
                      <Typography
                        variant="caption"
                        fontWeight={mode === value ? 700 : 400}
                        sx={{ color: mode === value ? 'primary.main' : 'text.secondary', display: 'block', fontSize: 11 }}
                      >
                        {label}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 9, lineHeight: 1.2, display: 'block' }}>
                        {desc}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Box>

              {/* Date fields depending on mode */}
              {mode === 'carry_over' && (
                <Box sx={{ display: 'flex', gap: 1.5 }}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.4, ml: 0.2 }}>
                      On Date
                    </Typography>
                    <TextField
                      fullWidth
                      size="small"
                      type="date"
                      value={date}
                      onChange={(e) => {
                        setDate(e.target.value);
                        // clear due date if it's now before the new start date
                        if (dueDate && e.target.value && dueDate < e.target.value) setDueDate('');
                      }}
                    />
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.4, ml: 0.2 }}>
                      Due date <span style={{ opacity: 0.6 }}>(optional)</span>
                    </Typography>
                    <TextField
                      fullWidth
                      size="small"
                      type="date"
                      inputProps={{ min: date || undefined }}
                      value={dueDate}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (date && val && val < date) setDueDate(date);
                        else setDueDate(val);
                      }}
                    />
                  </Box>
                </Box>
              )}

              {mode === 'fixed_day' && (
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.4, ml: 0.2 }}>
                    Date <span style={{ opacity: 0.6 }}>— task only appears on this day</span>
                  </Typography>
                  <TextField fullWidth size="small" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </Box>
              )}

              {/* Tags */}
              <Box>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <TextField
                    fullWidth
                    label="Tags"
                    size="small"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        addTag();
                      }
                    }}
                    placeholder="e.g. work, urgent"
                    helperText="Press Enter or comma to add"
                  />
                  <IconButton
                    size="small"
                    onClick={addTag}
                    sx={{ border: 1, borderColor: 'divider', borderRadius: 1, alignSelf: 'flex-start', mt: 0.3 }}
                  >
                    <AddIcon fontSize="small" />
                  </IconButton>
                </Box>
                {tags.length > 0 && (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                    {tags.map((t) => (
                      <Chip
                        key={t}
                        label={t}
                        size="small"
                        color="primary"
                        variant="outlined"
                        onDelete={() => setTags((p) => p.filter((x) => x !== t))}
                      />
                    ))}
                  </Box>
                )}
              </Box>

              {/* Color picker */}
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 0.8, display: 'block' }}>
                  Label color
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.8 }}>
                  {/* "Default" swatch — no color */}
                  <Box
                    onClick={() => setColor(null)}
                    title="Default"
                    sx={{
                      width: 24, height: 24, borderRadius: '50%',
                      border: 2,
                      borderColor: color === null ? 'primary.main' : 'divider',
                      bgcolor: 'action.hover',
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      '&:hover': { borderColor: 'primary.main' },
                    }}
                  >
                    {color === null && <CheckIcon sx={{ fontSize: 13, color: 'primary.main' }} />}
                  </Box>
                  {TASK_COLORS.map(({ id, label, bg, text }) => (
                    <Box
                      key={id}
                      onClick={() => setColor(id)}
                      title={label}
                      sx={{
                        width: 24, height: 24, borderRadius: '50%',
                        bgcolor: bg,
                        border: 2,
                        borderColor: color === id ? text : 'transparent',
                        cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        '&:hover': { borderColor: text },
                        transition: 'border-color 0.15s',
                      }}
                    >
                      {color === id && <CheckIcon sx={{ fontSize: 13, color: text }} />}
                    </Box>
                  ))}
                </Box>
              </Box>
            </Box>
          </Collapse>
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 2.5, pb: 2 }}>
        <Button onClick={onClose} size="small">
          Cancel
        </Button>
        <Button onClick={handleSubmit} variant="contained" size="small" disabled={!isValid()}>
          {isEdit ? 'Save changes' : 'Add Task'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
