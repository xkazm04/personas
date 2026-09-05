import { useCallback } from 'react';
import { NotepadText } from 'lucide-react';

import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

import { prefetchNotepadHost } from './notepadHostChunk';

/**
 * Footer toggle for the notepad layer.
 *
 * Ships in every build (unlike the DEV-gated fleet cluster beside it): a
 * scratch note is not dev tooling. Raising it is a LAYER, not a navigation —
 * one click to jot, one to close, and the page underneath never moved.
 *
 * Pointer-over and focus warm the overlay chunk. Hover is the earliest honest
 * signal of intent this control has, and it buys the ~100-200 ms of fetch +
 * evaluate that would otherwise sit between the click and the first painted
 * frame; `prefetchNotepadHost` is idempotent, so a hovered-but-never-clicked
 * icon costs exactly one import and never more.
 */
export default function NotepadFooterIcon() {
  const open = useSystemStore((s) => s.notepadOpen);
  const setOpen = useSystemStore((s) => s.notepadSetOpen);
  const { t } = useTranslation();

  const handleClick = useCallback(() => setOpen(!open), [open, setOpen]);
  const label = open ? t.notepad.footer_close : t.notepad.footer_open;

  // The hint goes through the shared Tooltip rather than a native `title=`:
  // the golden path (docs/concepts/golden-paths/tooltip.md) is that
  // explanatory text reaches a control through the one channel the app can
  // style, delay and place. `aria-label` still carries the name.
  return (
    <Tooltip content={label} placement="top">
      <button
        type="button"
        onClick={handleClick}
        onPointerEnter={prefetchNotepadHost}
        onFocus={prefetchNotepadHost}
        data-testid="footer-notepad"
        aria-label={label}
        aria-pressed={open}
        className={`w-7 h-7 rounded-card flex items-center justify-center transition-colors ${
          open
            ? 'text-primary bg-primary/10 hover:bg-primary/15 ring-1 ring-primary/30'
            : 'text-foreground hover:bg-secondary/50'
        }`}
      >
        <NotepadText className="w-5 h-5" aria-hidden />
      </button>
    </Tooltip>
  );
}
