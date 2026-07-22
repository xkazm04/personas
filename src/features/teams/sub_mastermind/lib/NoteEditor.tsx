// Note editor popover — text, three sizes, three fonts (each font button
// renders in its own face so the choice is visible before committing), delete.
// Commits live; Enter (without Shift) or Done closes.
import { Check, Trash2 } from 'lucide-react';

import { NOTE_FONT } from './ink';
import type { CanvasNote, NoteFont, NoteSize } from './types';

const COPY = { placeholder: 'Write a note…', done: 'Done', remove: 'Remove note' };

const SIZES: Array<{ id: NoteSize; label: string }> = [
  { id: 'sm', label: 'S' },
  { id: 'md', label: 'M' },
  { id: 'lg', label: 'L' },
];
const FONTS: Array<{ id: NoteFont; label: string }> = [
  { id: 'inter', label: 'Inter' },
  { id: 'roboto', label: 'Roboto' },
  { id: 'caveat', label: 'Caveat' },
];

export function NoteEditor({ note, x, y, onChange, onDelete, onClose }: {
  note: CanvasNote;
  /** Screen-space anchor (note position projected). */
  x: number;
  y: number;
  onChange: (patch: Partial<CanvasNote>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const chip = (active: boolean) =>
    `px-2.5 py-1 typo-caption rounded-interactive transition-colors focus-ring ${
      active ? 'bg-primary/15 text-foreground font-medium' : 'text-foreground/60 hover:text-foreground hover:bg-primary/5'
    }`;

  return (
    <div
      className="absolute z-30 w-[280px] p-2.5 rounded-card border border-primary/20 bg-secondary/95 shadow-elevation-3 space-y-2"
      style={{ left: Math.max(8, x - 140), top: Math.max(8, y - 170) }}
      onPointerDown={(e) => e.stopPropagation()}
      data-testid="mm-note-editor"
    >
      <textarea
        autoFocus
        value={note.text}
        rows={2}
        placeholder={COPY.placeholder}
        onChange={(e) => onChange({ text: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onClose(); }
          if (e.key === 'Escape') onClose();
        }}
        className="w-full px-2.5 py-1.5 typo-caption rounded-input bg-background/70 border border-primary/15 text-foreground outline-none focus:border-primary/40 resize-none"
        style={{ fontFamily: NOTE_FONT[note.font] }}
        data-testid="mm-note-text-input"
      />
      <div className="flex items-center gap-1">
        {SIZES.map((s) => (
          <button key={s.id} type="button" onClick={() => onChange({ size: s.id })} aria-pressed={note.size === s.id} className={chip(note.size === s.id)}>
            {s.label}
          </button>
        ))}
        <span className="w-px h-4 bg-primary/15 mx-1" aria-hidden />
        {FONTS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onChange({ font: f.id })}
            aria-pressed={note.font === f.id}
            className={chip(note.font === f.id)}
            style={{ fontFamily: NOTE_FONT[f.id] }}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={onDelete}
          aria-label={COPY.remove}
          className="p-1.5 rounded-interactive text-status-error/80 hover:text-status-error hover:bg-status-error/10 transition-colors focus-ring"
          data-testid="mm-note-delete"
        >
          <Trash2 className="w-4 h-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={COPY.done}
          className="p-1.5 rounded-interactive text-primary hover:bg-primary/10 transition-colors focus-ring"
          data-testid="mm-note-done"
        >
          <Check className="w-4 h-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
