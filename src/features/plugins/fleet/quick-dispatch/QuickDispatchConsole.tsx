import { ChevronRight, Terminal } from 'lucide-react';
import { ChatInputBar } from '@/features/shared/components/forms/ChatInputBar';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { QuickDispatchSuggestions } from './QuickDispatchSuggestions';
import { QUICK_DISPATCH_LISTBOX_ID, type QuickDispatchController } from './quickDispatchController';
import {
  QuickDispatchChips,
  QuickDispatchMetaLine,
  RecentDispatchRow,
} from './QuickDispatchParts';

/**
 * CONSOLE — a bottom-docked command deck (the Studio-dock / OrbQuickInputBar
 * family, with a terminal accent: mono values, a prompt caret, a status rail).
 *
 * Anti-shake by construction, model 1 — BOTTOM ANCHORING + OUT-OF-FLOW PANELS:
 * the deck is pinned to the bottom edge, so its own rows can never be pushed
 * around by content above; everything volatile (suggestions, the recent list)
 * renders in ONE absolutely-positioned panel above the deck (`bottom-full`),
 * outside document flow, animating opacity/translate only. Inside the deck,
 * every row has a reserved height: the chip rail is always mounted (empty or
 * not), and the meta line is the shared fixed-height swap slot.
 */
export function QuickDispatchConsole({ c }: { c: QuickDispatchController }) {
  const { quickT, tx } = c;
  const showSuggestions = !!c.token && (c.suggestions.length > 0 || !!c.suggestionHint);
  const showRecent = !showSuggestions && c.recent.length > 0;

  const monoChip = (isSet: string | null) =>
    `px-2 py-0.5 rounded-interactive border font-mono text-xs transition-colors ${
      isSet
        ? 'bg-primary/10 border-primary/25 text-primary'
        : 'border-foreground/10 text-foreground hover:bg-secondary/60'
    }`;

  return (
    <div className="absolute inset-x-0 bottom-8 flex justify-center px-6 pointer-events-none">
      <div
        ref={c.cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={quickT.title}
        className="pointer-events-auto relative w-full max-w-2xl"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            c.closeQuickDispatch();
          }
        }}
      >
        {/* The one volatile panel — absolutely anchored above the deck, so its
            appearance, growth and disappearance never move the deck a pixel. */}
        {(showSuggestions || showRecent) && (
          <div className="absolute bottom-full left-0 right-0 mb-2 animate-fade-slide-in">
            <div className="glass-md rounded-modal shadow-elevation-3 overflow-hidden">
              {showSuggestions ? (
                <div className="max-h-[38vh] overflow-y-auto p-1.5">
                  <QuickDispatchSuggestions
                    listboxId={QUICK_DISPATCH_LISTBOX_ID}
                    items={c.suggestions}
                    activeIndex={c.activeIndex}
                    hint={c.suggestionHint}
                    onPick={c.pickSuggestion}
                    onHoverIndex={c.setActiveIndex}
                  />
                </div>
              ) : (
                <div className="max-h-[32vh] overflow-y-auto p-1.5">
                  <div className="px-1.5 pb-1 pt-0.5 font-mono text-xs uppercase tracking-wider text-foreground/70">
                    {quickT.recent_title}
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

        {/* The deck — fixed-height rows only. */}
        <div className="glass-md rounded-modal shadow-elevation-4 p-2.5 animate-fade-slide-in">
          {/* Status rail: prompt caret + target path (mono), always one line. */}
          <div className="h-6 mb-1 flex items-center gap-1.5 px-1 font-mono text-xs text-foreground/80 overflow-hidden">
            <Terminal className="w-3.5 h-3.5 text-primary shrink-0" aria-hidden="true" />
            <ChevronRight className="w-3 h-3 text-primary shrink-0" aria-hidden="true" />
            <span className="truncate">
              {c.projectChip ? c.projectChip.root_path : quickT.placeholder}
            </span>
          </div>

          {/* Chip rail — ALWAYS mounted at a fixed height, chips or empty. */}
          <div
            className="h-7 mb-1 flex items-center gap-1 px-1 overflow-x-auto"
            data-testid="quick-dispatch-chips"
          >
            <QuickDispatchChips c={c} />
          </div>

          <div onKeyDownCapture={c.onComposerKeyDownCapture}>
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
              placeholder={quickT.placeholder}
              sendAriaLabel={quickT.send}
              inputTestId="quick-dispatch-input"
              sendTestId="quick-dispatch-send"
            />
          </div>

          {/* Controls row — fixed height; meta swaps inside its reserved slot. */}
          <div className="mt-1.5 flex items-center gap-2 px-1">
            <button
              type="button"
              onClick={c.cycleModel}
              className={monoChip(c.model)}
              data-testid="quick-dispatch-model-chip"
            >
              {c.model ? tx(quickT.model_chip, { model: c.model }) : quickT.model_chip_unset}
            </button>
            <button
              type="button"
              onClick={c.cycleEffort}
              className={monoChip(c.effort)}
              data-testid="quick-dispatch-effort-chip"
            >
              {c.effort ? tx(quickT.effort_chip, { effort: c.effort }) : quickT.effort_chip_unset}
            </button>
            <div className="min-w-0 flex-1 px-1">
              <QuickDispatchMetaLine c={c} />
            </div>
            <div className="ml-auto flex items-center gap-1.5 shrink-0">
              <span className="typo-caption text-foreground">{quickT.headless_label}</span>
              <AccessibleToggle
                checked={c.headless}
                onChange={c.toggleHeadless}
                label={quickT.headless_label}
                size="sm"
                data-testid="quick-dispatch-headless-toggle"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
