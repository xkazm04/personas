// Note editor popover — text, four sizes, three fonts, delete. The size
// buttons render at PROPORTIONAL type sizes and the textarea previews the
// chosen size+face live (capped so XL stays inside the dialog), so what you
// pick is what lands on the canvas. Commits live; Enter (no Shift) closes.
import { Check, Trash2 } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import { NOTE_FONT } from './ink';
import { NOTE_SIZE_PX } from './notes';
import type { CanvasNote, NoteFont, NoteSize } from './types';

// Button font size ≈ the applied world size, scaled to fit a control row.
const SIZES: Array<{ id: NoteSize; label: string; fs: number }> = [
  { id: 'sm', label: 'S', fs: 11 },
  { id: 'md', label: 'M', fs: 14 },
  { id: 'lg', label: 'L', fs: 18 },
  { id: 'xl', label: 'XL', fs: 22 },
];
const FONTS: Array<{ id: NoteFont; label: string }> = [
  { id: 'inter', label: 'Inter' },
  { id: 'roboto', label: 'Roboto' },
  { id: 'caveat', label: 'Caveat' },
];

/** Live textarea preview size — the real world px, capped for the dialog. */
const previewPx = (size: NoteSize) => Math.min(34, NOTE_SIZE_PX[size]);

export function NoteEditor({ note, x, y, onChange, onDelete, onClose }: {
  note: CanvasNote;
  /** Screen-space anchor (note position projected). */
  x: number;
  y: number;
  onChange: (patch: Partial<CanvasNote>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
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
        placeholder={t.mastermind.note_placeholder}
        onChange={(e) => onChange({ text: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onClose(); }
          if (e.key === 'Escape') onClose();
        }}
        className="w-full px-2.5 py-1.5 rounded-input bg-background/70 border border-primary/15 text-foreground outline-none focus:border-primary/40 resize-none"
        style={{ fontFamily: NOTE_FONT[note.font], fontSize: previewPx(note.size), lineHeight: 1.25 }}
        data-testid="mm-note-text-input"
      />
      {/* sizes — buttons scale with the size they apply, baseline-aligned */}
      <div className="flex items-end gap-1">
        {SIZES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onChange({ size: s.id })}
            aria-pressed={note.size === s.id}
            className={chip(note.size === s.id)}
            style={{ fontSize: s.fs, lineHeight: 1.1 }}
          >
            {s.label}
          </button>
        ))}
      </div>
      {/* fonts — own row so all three faces fit comfortably */}
      <div className="flex items-center gap-1">
        {FONTS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onChange({ font: f.id })}
            aria-pressed={note.font === f.id}
            className={chip(note.font === f.id)}
            style={{ fontFamily: NOTE_FONT[f.id], fontSize: 14 }}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={onDelete}
          aria-label={t.mastermind.note_remove}
          className="p-1.5 rounded-interactive text-status-error/80 hover:text-status-error hover:bg-status-error/10 transition-colors focus-ring"
          data-testid="mm-note-delete"
        >
          <Trash2 className="w-4 h-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.common.done}
          className="p-1.5 rounded-interactive text-primary hover:bg-primary/10 transition-colors focus-ring"
          data-testid="mm-note-done"
        >
          <Check className="w-4 h-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
