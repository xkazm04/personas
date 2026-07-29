/**
 * CockpitChrome — the header band and the footer keyboard strip.
 *
 * The header answers "where am I in this queue and how much of it is left"; the
 * footer is the variant's promise that it teaches its own keyboard, printed
 * once at the foot of the surface so nobody has to discover a shortcut by
 * accident. Both are fixed bands so the three panes between them own every
 * remaining pixel.
 *
 * ⚠️ PROTOTYPE (/prototype round 1): English literals inline, `src/i18n/**` is
 * off-limits this round. See cockpitKinds.tsx for the full note.
 */
import type { ReactNode } from 'react';
import { Keyboard, X } from 'lucide-react';

import { ShortcutLegend } from './ShortcutChip';
import { COCKPIT_LEGEND } from './useCockpitKeyboard';

export function CockpitHeader({
  position,
  inView,
  decided,
  sessionTotal,
  switcher,
  onClose,
}: {
  /** 1-based cursor position, or 0 when the queue is empty. */
  position: number;
  inView: number;
  decided: number;
  sessionTotal: number;
  switcher?: ReactNode;
  onClose: () => void;
}) {
  const progress = sessionTotal > 0 ? Math.round((decided / sessionTotal) * 100) : 0;

  return (
    <header className="shrink-0 h-14 flex items-center gap-5 px-5 border-b border-primary/12 bg-secondary/15">
      <div className="flex items-baseline gap-3 min-w-0">
        <h1 className="typo-heading-lg text-foreground whitespace-nowrap">Triage cockpit</h1>
        <span className="typo-caption text-foreground whitespace-nowrap tabular-nums">
          {inView > 0 ? `${position} of ${inView} in view` : 'Nothing in view'}
        </span>
      </div>

      <div className="hidden lg:flex items-center gap-2.5 w-[240px] shrink-0">
        <span className="h-1.5 flex-1 rounded-pill bg-primary/12 overflow-hidden">
          <span
            className="block h-full rounded-pill bg-primary transition-[width] duration-300 motion-reduce:transition-none"
            style={{ width: `${progress}%` }}
          />
        </span>
        <span className="typo-caption text-foreground tabular-nums whitespace-nowrap">
          {decided}/{sessionTotal} cleared
        </span>
      </div>

      <div className="ml-auto flex items-center gap-2 shrink-0">
        {switcher}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the triage cockpit (Esc)"
          title="Close (Esc)"
          className="p-2 rounded-interactive border border-primary/15 text-foreground hover:bg-secondary/50 transition-colors focus-ring"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

export function CockpitFooter() {
  return (
    <footer className="shrink-0 flex items-center gap-4 px-5 py-2.5 border-t border-primary/12 bg-secondary/15">
      <Keyboard className="w-4 h-4 shrink-0 text-primary" aria-hidden="true" />
      <ShortcutLegend entries={COCKPIT_LEGEND} className="min-w-0" />
    </footer>
  );
}
