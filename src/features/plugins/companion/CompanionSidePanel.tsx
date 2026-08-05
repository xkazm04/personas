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
 * an INNER right-side dock, not a replacement for the toolbar. Any
 * glanceable feature surface (Fleet stats today; more later) can mount here
 * without touching the chat layout: this shell owns the collapse/expand
 * affordance and the width transition, the caller only supplies content.
 * Collapsed state renders a slim icon-only rail rather than unmounting, so
 * the slot never causes a layout jump when toggled.
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
      aria-label={label}
      className={`relative shrink-0 border-l border-foreground/10 bg-foreground/[0.02] flex flex-col overflow-hidden transition-[width] duration-200 ease-out ${
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
        className="absolute left-0 top-3 -translate-x-1/2 z-10 inline-flex items-center justify-center w-5 h-5 rounded-full bg-secondary border border-foreground/15 text-foreground hover:bg-foreground/10 hover:border-foreground/25 shadow-elevation-2 transition-colors focus-ring"
      >
        {open ? <ChevronLeft className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>

      {open ? (
        <div className="flex flex-col h-full min-h-0 pt-3">
          <div className="flex items-center gap-1.5 px-3 pb-2 shrink-0" aria-hidden="true">
            {icon}
            <span className="typo-label text-foreground truncate">{label}</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-2 pb-2 space-y-1.5">
            {children}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center pt-3" aria-hidden="true">
          {icon}
        </div>
      )}
    </aside>
  );
}
