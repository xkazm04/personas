/**
 * AthenaChatCompactHandle — the way back out of compact mode.
 *
 * Compact hides the whole toolbar rail so the shrunk panel is conversation and
 * nothing else. That rail is also where the expand arrow normally lives, so
 * this is the minimum that has to survive: a 20px strip holding the same
 * arrow tab, in the same place on the panel's right edge, with the same testid
 * — so muscle memory and the automation harness both still find it.
 */

import { ChevronRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';

export function AthenaChatCompactHandle() {
  const { t } = useTranslation();
  const setCompact = useSystemStore((s) => s.setCompanionPanelCompact);
  const label = t.plugins.companion.compact_toggle_expand;

  return (
    <div
      className="relative shrink-0 w-5 border-l border-foreground/10 bg-foreground/[0.02]"
      data-testid="companion-compact-rail"
    >
      <button
        type="button"
        onClick={() => setCompact(false)}
        data-testid="companion-toggle-compact"
        aria-pressed
        aria-label={label}
        title={label}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 inline-flex items-center justify-center w-5 h-14 rounded-full bg-secondary border border-foreground/15 text-foreground hover:bg-foreground/10 hover:border-foreground/25 shadow-elevation-2 transition-colors focus-ring"
      >
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
