/**
 * TaskColorPopover
 * A small popover color-picker for task label colors.
 *
 * Props:
 *   anchorEl   {Element|null}  — MUI Popover anchor
 *   onClose    {function}
 *   currentColor {string|null} — currently selected color id
 *   onSelect   {function}  (colorId | null) => void
 */
import React from 'react';
import { Popover, Box, Tooltip, Typography } from '@mui/material';
import { Check as CheckIcon } from '@mui/icons-material';
import { TASK_COLORS } from '../constants/taskColors.js';

export default function TaskColorPopover({ anchorEl, onClose, currentColor, onSelect }) {
  const open = Boolean(anchorEl);

  // When no color is set, the pill falls back to blue — reflect that in the picker
  const effectiveColor = currentColor ?? 'blue';

  const handleSelect = (colorId) => {
    onSelect(colorId);
    onClose();
  };

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{ paper: { sx: { p: 1.2, borderRadius: 2, boxShadow: 4 } } }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.8, px: 0.3, fontWeight: 600 }}>
        Label color
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6, width: 168 }}>
        {/* Reset action (no selected state to avoid double-check with effective blue) */}
        <Tooltip title="Reset to default (Blue)" placement="top">
          <Box
            onClick={() => handleSelect(null)}
            sx={{
              width: 22,
              height: 22,
              borderRadius: 1,
              border: 2,
              borderColor: 'divider',
              bgcolor: 'background.default',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              '&:hover': { borderColor: 'primary.main' },
              transition: 'border-color 0.15s',
            }}
          >
            <Typography variant="caption" sx={{ fontSize: 9, color: 'text.secondary', lineHeight: 1 }}>
              D
            </Typography>
          </Box>
        </Tooltip>

        {TASK_COLORS.map(({ id, label, bg, text }) => (
          <Tooltip key={id} title={label} placement="top">
            <Box
              onClick={() => handleSelect(id)}
              sx={{
                width: 22,
                height: 22,
                borderRadius: 1,
                bgcolor: bg,
                border: 2,
                borderColor: effectiveColor === id ? text : 'transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                '&:hover': { borderColor: text },
                transition: 'border-color 0.15s',
              }}
            >
              {effectiveColor === id && <CheckIcon sx={{ fontSize: 11, color: text }} />}
            </Box>
          </Tooltip>
        ))}
      </Box>
    </Popover>
  );
}
