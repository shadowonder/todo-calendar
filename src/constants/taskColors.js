/**
 * 10 curated task color sets.
 * Each entry: { id, label, bg, text }
 *   bg   — pill background color
 *   text — pill text color
 */
export const TASK_COLORS = [
  { id: 'blue',   label: 'Blue',   bg: '#DBEAFE', text: '#1E40AF' },
  { id: 'green',  label: 'Green',  bg: '#DCFCE7', text: '#166534' },
  { id: 'yellow', label: 'Yellow', bg: '#FEF9C3', text: '#854D0E' },
  { id: 'red',    label: 'Red',    bg: '#FEE2E2', text: '#991B1B' },
  { id: 'purple', label: 'Purple', bg: '#EDE9FE', text: '#5B21B6' },
  { id: 'pink',   label: 'Pink',   bg: '#FCE7F3', text: '#9D174D' },
  { id: 'orange', label: 'Orange', bg: '#FFEDD5', text: '#9A3412' },
  { id: 'teal',   label: 'Teal',   bg: '#CCFBF1', text: '#115E59' },
  { id: 'indigo', label: 'Indigo', bg: '#E0E7FF', text: '#3730A3' },
  { id: 'gray',   label: 'Gray',   bg: '#F1F5F9', text: '#334155' },
];

/** Given a color id, return { bg, text }. Falls back to default blue if unknown. */
export function resolveTaskColor(colorId) {
  return TASK_COLORS.find((c) => c.id === colorId) ?? TASK_COLORS[0];
}

