// QuickDispatchDock — Activity's composer.
//
// Conversations has `ConversationComposer` pinned under its stream: the surface
// you are reading and the place you act on it are one column. Activity had no
// such place — dispatching a session meant summoning the Quick Dispatch overlay
// over the top of the board you were reading, or leaving for the Fleet page.
// This is that composer, in the same position, for the Activity board.
//
// IT IS THE SAME CONSOLE, not a second one. The brain is `useQuickDispatchController`
// (`inline: true`), and the leaf pieces — chips, the reserved meta line, the
// typeahead panel — are the overlay's own, so the `@project` / `/skill` grammar,
// the headless fallback and the ARIA combobox contract cannot drift between the
// two hosts. What is re-authored here is the SHELL, for two reasons:
//
//   • The overlay floated on a scrim, so it wore `glass-md` + `shadow-elevation-4`
//     and rounded on all four corners. Docked inside the Activity card, that same
//     treatment reads as a modal that forgot to open — a pane inside a pane. The
//     dock wears the Conversations composer's chrome instead: a single top
//     hairline, the surface's own tint, no shadow, no radius.
//   • COLLAPSED IS THE RESTING STATE. The overlay was summoned, so it was always
//     open; the dock is permanent, so it must cost the board almost nothing when
//     nobody is dispatching. Collapsed it is one 36px row.
//
// The overlay itself was retired on 2026-09-01 — this dock replaced it, and two
// composers for one grammar is one composer too many. Its leaf pieces
// (`QuickDispatchParts`, `QuickDispatchSuggestions`) and its brain outlive it
// here, which is why the migration cost nothing.
//
// The anti-shake contract the console won its /prototype round on is preserved
// verbatim: the volatile panel (suggestions / recent) renders absolutely at
// `bottom-full`, out of document flow, and every row inside the deck has a
// reserved height — the chip rail is always mounted, and the meta line is a
// fixed-height swap slot. A dock that jumped as you typed would be worse here
// than in the overlay, because the board above it would jump too.

import { useCallback, useState } from 'react';
import { ChevronDown, ChevronRight, Terminal } from 'lucide-react';
import { ChatInputBar } from '@/features/shared/components/forms/ChatInputBar';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useTranslation } from '@/i18n/useTranslation';
import { QuickDispatchSuggestions } from '@/features/plugins/fleet/quick-dispatch/QuickDispatchSuggestions';
import { useQuickDispatchController } from '@/features/plugins/fleet/quick-dispatch/quickDispatchController';
import {
  QuickDispatchChips,
  QuickDispatchMetaLine,
  RecentDispatchRow,
} from '@/features/plugins/fleet/quick-dispatch/QuickDispatchParts';

/** This dock's own typeahead listbox id — see the controller call below. */
const DOCK_LISTBOX_ID = 'activity-dock-typeahead-listbox';

export function QuickDispatchDock() {
  const { t } = useTranslation();
  // Its own listbox id rather than the module default: two composers
  // advertising the same `aria-controls` target would be one pointing at the
  // other's suggestions. The overlay that made that concrete is gone; the
  // property is kept because the next second host will not announce itself.
  const c = useQuickDispatchController({ listboxId: DOCK_LISTBOX_ID });
  const [expanded, setExpanded] = useState(false);

  const { focusInput } = c;
  const expand = useCallback(() => {
    setExpanded(true);
    focusInput();
  }, [focusInput]);

  const showSuggestions = !!c.token && (c.suggestions.length > 0 || !!c.suggestionHint);
  const showRecent = !showSuggestions && c.recent.length > 0;

  const chip = (isSet: string | null) =>
    `rounded-interactive border px-2 py-0.5 font-mono text-xs transition-colors ${
      isSet
        ? 'border-primary/25 bg-primary/10 text-primary'
        : 'border-border text-foreground hover:bg-secondary/60'
    }`;

  if (!expanded) {
    return (
      <div className="flex-shrink-0 border-t border-border bg-foreground/[0.015]">
        <button
          type="button"
          onClick={expand}
          data-testid="quick-dispatch-dock-expand"
          className="flex h-9 w-full items-center gap-2 px-3 text-left transition-colors hover:bg-secondary/30"
        >
          <Terminal className="h-3.5 w-3.5 flex-shrink-0 text-primary" aria-hidden />
          <ChevronRight className="h-3 w-3 flex-shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground opacity-55">
            {c.quickT.placeholder}
          </span>
          <span className="typo-label text-foreground opacity-50">{c.quickT.title}</span>
        </button>
      </div>
    );
  }

  return (
    <div
      ref={c.cardRef}
      className="relative flex-shrink-0 border-t border-border bg-foreground/[0.015]"
      data-testid="quick-dispatch-dock"
      onKeyDown={(e) => {
        // Escape collapses the dock rather than closing anything global — the
        // controller's own Escape handling (strip the open typeahead token) runs
        // first, in the capture phase, so the first press never collapses a
        // console the operator was mid-token in.
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setExpanded(false);
        }
      }}
    >
      {/* The one volatile panel — absolutely anchored ABOVE the dock, out of
          flow, so its appearance never moves the dock or the board. */}
      {(showSuggestions || showRecent) && (
        <div className="absolute bottom-full left-0 right-0 z-30 mb-1 px-3">
          <div className="animate-fade-slide-in overflow-hidden rounded-card border border-border bg-background shadow-elevation-3">
            {showSuggestions ? (
              <div className="max-h-[38vh] overflow-y-auto p-1.5">
                <QuickDispatchSuggestions
                  listboxId={c.listboxId}
                  items={c.suggestions}
                  activeIndex={c.activeIndex}
                  hint={c.suggestionHint}
                  onPick={c.pickSuggestion}
                  onHoverIndex={c.setActiveIndex}
                />
              </div>
            ) : (
              <div className="max-h-[32vh] overflow-y-auto p-1.5">
                <div className="px-1.5 pb-1 pt-0.5 typo-label uppercase tracking-wider text-foreground opacity-60">
                  {c.quickT.recent_title}
                </div>
                <ul className="flex flex-col" data-testid="quick-dispatch-recent-list">
                  {c.recent.map((s) => (
                    <li key={s.id}>
                      <RecentDispatchRow c={c} session={s} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Status rail — the target path, and the collapse control. One line,
          always. */}
      <div className="flex h-8 items-center gap-1.5 px-3 font-mono text-xs text-foreground opacity-80">
        <Terminal className="h-3.5 w-3.5 flex-shrink-0 text-primary" aria-hidden />
        <ChevronRight className="h-3 w-3 flex-shrink-0 text-primary" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          {c.projectChip ? c.projectChip.root_path : c.quickT.placeholder}
        </span>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-label={t.monitor.grid_dock_collapse}
          data-testid="quick-dispatch-dock-collapse"
          className="flex-shrink-0 rounded-interactive p-0.5 text-foreground opacity-50 transition-colors hover:bg-secondary/60 hover:opacity-100"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Chip rail — ALWAYS mounted at a fixed height, chips or empty. */}
      <div className="mb-1 flex h-6 items-center gap-1 overflow-x-auto px-3" data-testid="quick-dispatch-chips">
        <QuickDispatchChips c={c} />
      </div>

      <div className="px-3" onKeyDownCapture={c.onComposerKeyDownCapture}>
        <ChatInputBar
          value={c.value}
          onChange={c.setValue}
          onSubmit={() => {
            if (c.canSend) void c.handleSubmit();
          }}
          multiline
          busy={c.sending}
          disabled={c.sending}
          boxShadow={c.stateShadow}
          placeholder={c.quickT.placeholder}
          sendAriaLabel={c.quickT.send}
          inputTestId="quick-dispatch-input"
          sendTestId="quick-dispatch-send"
        />
      </div>

      {/* Controls row — fixed height; the meta line swaps inside its slot. */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <button type="button" onClick={c.cycleModel} className={chip(c.model)} data-testid="quick-dispatch-model-chip">
          {c.model ? c.tx(c.quickT.model_chip, { model: c.model }) : c.quickT.model_chip_unset}
        </button>
        <button type="button" onClick={c.cycleEffort} className={chip(c.effort)} data-testid="quick-dispatch-effort-chip">
          {c.effort ? c.tx(c.quickT.effort_chip, { effort: c.effort }) : c.quickT.effort_chip_unset}
        </button>
        <div className="min-w-0 flex-1 px-1">
          <QuickDispatchMetaLine c={c} />
        </div>
        <div className="ml-auto flex flex-shrink-0 items-center gap-1.5">
          <span className="typo-caption text-foreground">{c.quickT.headless_label}</span>
          <AccessibleToggle
            checked={c.headless}
            onChange={c.toggleHeadless}
            label={c.quickT.headless_label}
            size="sm"
            data-testid="quick-dispatch-headless-toggle"
          />
        </div>
      </div>
    </div>
  );
}

export default QuickDispatchDock;
