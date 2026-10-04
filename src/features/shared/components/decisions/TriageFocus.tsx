/**
 * @catalog Focused triage surface for a queue of TriageItems - N-of-M navigation, a per-decision carousel, arm-then-confirm keyboard, and an optional queue sidebar.
 *
 * TriageFocus — the app's one good triage experience, extracted.
 *
 * Two surfaces triage the same work and one of them is clearly better. The
 * Overview flow (`sub_manual-review/components/ReviewFocusFlow.tsx`, 694 lines)
 * gives a reviewer a queue rail, "N of M" with prev/next, a direction-aware
 * spring slide, an inner carousel for an item that carries several decisions,
 * and a two-press keyboard where every verdict can carry a note. The Monitor's
 * docked rail opens `RailTriageModal` (173 lines): a modal, three buttons, and
 * no verdict hotkeys at all. This module is the first one's EXPERIENCE over the
 * second one's MODEL, so both surfaces can render it.
 *
 * It speaks `TriageItem` — the unified shape over six kinds — and never
 * `TriageReview`, so it is not a manual-review component wearing a shared
 * directory. Nothing here imports from a feature's `libs/`, reads a severity
 * string, or names a palette hue; tone comes from the item's own vocabulary.
 *
 * DENSITY IS A PROP, NOT A BRANCH. `queueSidebar` adds the 330px rail. The
 * Monitor's dock is 320px wide (`RAIL_DEFAULT_WIDTH`), so it cannot carry one
 * and does not need to — its tab list already is the queue. Default: off.
 */
import { useCallback, type ReactNode } from 'react';

import { ROUTE_DECISION_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { InboxZero } from '@/features/shared/components/feedback/ScenarioEmptyState';
import type { TriageItem } from '@/features/shared/triage/triageFocusBridge';
import { useTranslation } from '@/i18n/useTranslation';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { TriageFocusActions } from './TriageFocusActions';
import { TriageFocusCard } from './TriageFocusCard';
import { TriageFocusQueue } from './TriageFocusQueue';
import { useTriageFocus, type TriageFocusDecide } from './useTriageFocus';

export interface TriageFocusProps {
  /** The queue, already ordered. Resolved rows are the caller's to remove. */
  items: readonly TriageItem[];
  /** Write one verdict. REJECT the promise to report a failed write — the item
   *  then stays open with its note and its per-decision verdicts intact. */
  onDecide: TriageFocusDecide;
  /** Controlled cursor. Omit it and the component owns its own. */
  index?: number;
  onIndexChange?: (index: number) => void;
  /** Render the 330px queue rail. Off by default — see the module header. */
  queueSidebar?: boolean;
  /** Claim the arrow keys at `ROUTE_DECISION_PRIORITY`. Default true. */
  keyboard?: boolean;
  /** Replaces the default "All caught up" state. */
  emptyState?: ReactNode;
  className?: string;
}

export function TriageFocus({
  items, onDecide, index, onIndexChange, queueSidebar = false, keyboard = true,
  emptyState, className,
}: TriageFocusProps) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const ctl = useTriageFocus(items, onDecide, index, onIndexChange);
  const { item, option, options, armed, busy } = ctl;
  const multi = options.length > 1;

  /**
   * Arrows decide, digits branch — the app's one triage keyboard.
   *
   * Registered on the app keyboard REGISTRY at route level, never as a bare
   * `window` keydown listener: a full-app decision surface layered over this
   * route (the triage deck maps the same arrows) must claim them first, and on
   * two bare listeners one press decided two rows, one of them behind an
   * opaque overlay.
   */
  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return false;
    if (busy || !item) return false;

    // Multi-decision mode: the arrows rule on the FOCUSED option and the bar
    // keeps the rule-on-all-of-them act, exactly as the donor had it.
    const perOption = multi && !!option && armed === null;

    const arm = (verdict: 'accept' | 'reject' | 'skip') => {
      if (armed === verdict) void ctl.commit(verdict);
      else { ctl.setArmed(verdict); ctl.setNote(''); }
    };

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (perOption) ctl.decideOption(option!.id, 'accept'); else arm('accept');
      return true;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (perOption) ctl.decideOption(option!.id, 'reject'); else arm('reject');
      return true;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); arm('skip'); return true; }
    if (e.key === 'Enter' && armed) { e.preventDefault(); void ctl.commit(armed); return true; }
    if (e.key === 'PageDown') { e.preventDefault(); ctl.goNext(); return true; }
    if (e.key === 'PageUp') { e.preventDefault(); ctl.goPrev(); return true; }
    if (/^[1-9]$/.test(e.key)) {
      const branch = item.branches[Number(e.key) - 1];
      if (!branch) return false;
      e.preventDefault();
      void ctl.commit('accept', { branchId: branch.id });
      return true;
    }
    if (e.key === 'Escape') {
      // Never consumed: an overlay above this route owns Escape.
      if (armed) { ctl.setArmed(null); ctl.setNote(''); }
    }
    return false;
  }, [busy, item, multi, option, armed, ctl]);

  useAppKeyboard(onKey, { priority: ROUTE_DECISION_PRIORITY, enabled: keyboard });

  if (!item) {
    return (
      <div className={`flex items-center justify-center py-12 ${className ?? ''}`.trim()}>
        {emptyState ?? (
          <InboxZero title={m.triage_focus_empty_title} subtitle={m.triage_focus_empty_subtitle} />
        )}
      </div>
    );
  }

  return (
    <div className={`flex min-h-0 overflow-hidden ${className ?? ''}`.trim()} data-testid="triage-focus">
      {queueSidebar && (
        <TriageFocusQueue items={items} index={ctl.index} onSelect={ctl.goTo} />
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-primary/10 px-3 py-2">
          <span className="typo-body text-foreground">
            {tx(m.triage_focus_position, { current: ctl.index + 1, total: items.length })}
          </span>
          <div className="flex items-center gap-1">
            <Tooltip content={m.triage_focus_prev}>
              <Button variant="ghost" size="icon-sm" onClick={ctl.goPrev} disabled={ctl.index === 0} aria-label={m.triage_focus_prev}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
            </Tooltip>
            <Tooltip content={m.triage_focus_next}>
              <Button variant="ghost" size="icon-sm" onClick={ctl.goNext} disabled={ctl.index >= items.length - 1} aria-label={m.triage_focus_next}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </Tooltip>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <TriageFocusCard item={item} ctl={ctl} />
        </div>

        <TriageFocusActions item={item} ctl={ctl} hasOptions={multi} />
      </div>
    </div>
  );
}

export default TriageFocus;
