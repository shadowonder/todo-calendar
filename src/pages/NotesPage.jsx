import React, { useState } from 'react';
import {
  Box, Typography, Paper, TextField, Button, List, ListItem,
  ListItemText, Divider, IconButton, Chip,
} from '@mui/material';
import { Delete as DeleteRoundedIcon, NoteAdd as NoteAddRoundedIcon } from '@mui/icons-material';

export default function NotesPage() {
  const [notes, setNotes] = useState([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [selected, setSelected] = useState(null);

  const save = () => {
    if (!title.trim() && !content.trim()) return;
    if (selected !== null) {
      setNotes(prev => prev.map((n, i) => i === selected ? { ...n, title, content, updatedAt: new Date() } : n));
    } else {
      setNotes(prev => [...prev, { title, content, createdAt: new Date(), updatedAt: new Date() }]);
    }
    setSelected(null); setTitle(''); setContent('');
  };

  const deleteNote = (i) => {
    setNotes(prev => prev.filter((_, idx) => idx !== i));
    if (selected === i) { setSelected(null); setTitle(''); setContent(''); }
  };

  const selectNote = (i) => {
    setSelected(i); setTitle(notes[i].title); setContent(notes[i].content);
  };

  const newNote = () => { setSelected(null); setTitle(''); setContent(''); };

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Left note list */}
      <Box sx={{ width: 280, borderRight: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', bgcolor: 'background.paper' }}>
        <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="subtitle1" fontWeight={700}>Notes</Typography>
                  <IconButton size="small" color="primary" onClick={newNote}><NoteAddRoundedIcon /></IconButton>
        </Box>
        <List sx={{ flexGrow: 1, overflow: 'auto', py: 0 }}>
          {notes.length === 0 && (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">No notes yet</Typography>
            </Box>
          )}
          {notes.map((n, i) => (
            <React.Fragment key={i}>
              <ListItem
                onClick={() => selectNote(i)}
                secondaryAction={
                  <IconButton edge="end" size="small" onClick={e => { e.stopPropagation(); deleteNote(i); }} sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}>
                    <DeleteRoundedIcon fontSize="small" />
                  </IconButton>
                }
                sx={{ cursor: 'pointer', bgcolor: selected === i ? 'action.selected' : 'transparent', pr: 5, '&:hover': { bgcolor: selected === i ? 'action.selected' : 'action.hover' } }}
              >
                <ListItemText
                  primary={<Typography variant="body2" fontWeight={600} noWrap>{n.title || 'Untitled'}</Typography>}
                  secondary={
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {n.content || 'No content'}
                    </Typography>
                  }
                />
              </ListItem>
              <Divider />
            </React.Fragment>
          ))}
        </List>
      </Box>

      {/* Right editor */}
      <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', p: 3, gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Typography variant="h6" fontWeight={700} sx={{ flexGrow: 1 }}>
            {selected !== null ? 'Edit Note' : 'New Note'}
          </Typography>
          {selected !== null && <Chip label="Editing" color="primary" size="small" />}
        </Box>

        <TextField
          fullWidth label="Title" variant="outlined" size="small"
          value={title} onChange={e => setTitle(e.target.value)}
          placeholder="Note title..."
        />

        <TextField
          fullWidth label="Content" variant="outlined" multiline
          minRows={16} maxRows={28}
          value={content} onChange={e => setContent(e.target.value)}
          placeholder="Write your note here..."
          sx={{ flexGrow: 1, '& .MuiInputBase-root': { height: '100%', alignItems: 'flex-start' } }}
        />

        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
          {selected !== null && (
            <Button variant="outlined" onClick={newNote}>New</Button>
          )}
          <Button variant="contained" onClick={save} disabled={!title.trim() && !content.trim()}>
            {selected !== null ? 'Update' : 'Save'}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}





