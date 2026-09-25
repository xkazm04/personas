import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { OVERLAY_DISMISS_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { guideStrings } from './guideCopy';

// The notes waiting for Athena's next step. The count is a button: it opens the
// list above the Now line, where each note can be read in full and taken back
// before she starts on it. Esc or a second click closes it.
export default function GuideQueuedNotes({ notes, onRemove }: { notes: string[]; onRemove: (index: number) => void }) {
  const { t, tx } = useTranslation();
  const g = guideStrings(t);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (notes.length === 0) setOpen(false);
  }, [notes.length]);
  useAppKeyboard(
    (e) => {
      if (e.key !== 'Escape') return false;
      setOpen(false);
      e.preventDefault();
      return true;
    },
    { enabled: open, priority: OVERLAY_DISMISS_PRIORITY },
  );
  if (notes.length === 0) return null;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        className="rounded-full border border-border px-2.5 py-0.5 typo-caption text-foreground/90 hover:bg-secondary/60"
      >
        {tx(g.notes_waiting, { count: notes.length })}
      </button>
      {open && (
        <ul className="absolute bottom-full right-0 z-30 mb-2 flex w-80 flex-col gap-1 rounded-card border border-border bg-background p-2 shadow-elevation-3">
          {notes.map((note, i) => (
            <li key={`${i}-${note}`} className="flex items-start gap-2 rounded-interactive px-2 py-1.5 hover:bg-secondary/50">
              <p className="min-w-0 flex-1 break-words typo-body text-foreground">{note}</p>
              <button
                type="button"
                onClick={() => onRemove(i)}
                aria-label={g.note_remove}
                className="shrink-0 rounded-interactive p-1 text-foreground/70 hover:bg-secondary hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
