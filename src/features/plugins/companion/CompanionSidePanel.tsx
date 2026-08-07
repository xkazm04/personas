import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

export interface CompanionSidePanelProps {
  /** Small glanceable icon shown in the header and on the collapsed rail. */
  icon: ReactNode;
  /** Panel title / aria-label. */
  label: string;
  open: boolean;
  onToggleOpen: () => void;
  testId?: string;
  children: ReactNode;
}

/**
 * Reusable inner side-panel slot for the companion chat window.
 *
 * Sits between the chat column and the outer `CompanionToolbar` edge rail —
 * an INNER right-side dock, not a replacement for the toolbar. Any glanceable
 * feature surface (Fleet stats today; more later) can mount here without
 * touching the chat layout: this shell owns the collapse/expand affordance and
 * the width transition, the caller only supplies content. Collapsed state
 * renders a slim icon-only rail rather than unmounting, so the slot never
 * causes a layout jump when toggled.
 *
 * Two structural rules, both learned the hard way:
 *
 *  - **The panel is always full height.** It used to size to its content, so a
 *    quiet fleet left a stub of a panel floating against the chat's full-height
 *    column and the border stopped halfway down. `self-stretch` + `h-full` make
 *    the rail read as part of the window frame at any content length.
 *  - **The toggle handle escapes the panel's own clip.** It is deliberately
 *    positioned OUTSIDE the `overflow-hidden` body wrapper: the handle straddles
 *    the panel's left border, and a shared `overflow-hidden` on the same element
 *    that positions it clipped its outer half away, leaving a half-moon that
 *    read as sitting *behind* the chat column.
 */
export function CompanionSidePanel({
  icon,
  label,
  open,
  onToggleOpen,
  testId,
  children,
}: CompanionSidePanelProps) {
  const { t } = useTranslation();
  const rootTestId = testId ?? 'companion-side-panel';

  return (
    <aside
      data-testid={rootTestId}
      data-side-panel-open={open ? 'true' : 'false'}
      aria-label={label}
      // `overflow-visible` here (the clip lives on the inner body) is what lets
      // the handle sit proud of the border; `z-20` lifts the whole rail above
      // the chat column so the handle is hit-testable, not just visible.
      className={`relative z-20 shrink-0 self-stretch h-full border-l border-foreground/10 bg-foreground/[0.02] flex flex-col overflow-visible transition-[width] duration-200 ease-out ${
        open ? 'w-44' : 'w-9'
      }`}
    >
      <button
        type="button"
        onClick={onToggleOpen}
        data-testid={`${rootTestId}-toggle`}
        aria-pressed={open}
        aria-label={
          open ? t.plugins.companion.side_panel_collapse : t.plugins.companion.side_panel_expand
        }
        title={
          open ? t.plugins.companion.side_panel_collapse : t.plugins.companion.side_panel_expand
        }
        className="absolute left-0 top-3 -translate-x-1/2 z-30 inline-flex items-center justify-center w-5 h-5 rounded-full bg-secondary border border-foreground/20 text-foreground hover:bg-foreground/10 hover:border-foreground/35 shadow-elevation-3 transition-colors focus-ring"
      >
        {open ? <ChevronLeft className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>

      {open ? (
        <div className="flex flex-col h-full min-h-0 overflow-hidden pt-3">
          <div className="flex items-center gap-1.5 px-3 pb-2 shrink-0" aria-hidden="true">
            {icon}
            <span className="typo-caption font-semibold text-foreground truncate">{label}</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-2 pb-2 space-y-1.5">
            {children}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center h-full overflow-hidden pt-3" aria-hidden="true">
          {icon}
        </div>
      )}
    </aside>
  );
}
