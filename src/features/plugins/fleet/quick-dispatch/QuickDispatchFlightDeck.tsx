import { Rocket, X } from 'lucide-react';
import { ChatInputBar } from '@/features/shared/components/forms/ChatInputBar';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { QuickDispatchSuggestions } from './QuickDispatchSuggestions';
import { QUICK_DISPATCH_LISTBOX_ID, type QuickDispatchController } from './quickDispatchController';
import {
  QuickDispatchChips,
  QuickDispatchMetaLine,
  RecentDispatchRow,
  controlChipClass,
} from './QuickDispatchParts';

/**
 * FLIGHT DECK — a mission-panel: one wide card with a HARD height, a header
 * band, the composer on the left and a context rail on the right.
 *
 * Anti-shake by construction, model 2 — FIXED GEOMETRY + PANE SWAPPING: the
 * card is `h-[400px]` and never resizes; nothing mounts above the input (the
 * chip rail is an always-rendered fixed-height row, the meta line a reserved
 * swap slot), and everything volatile lives in the right rail, which crossfades
 * between the recent list and the typeahead suggestions inside its own
 * scrollable bounds. The input cannot move because no layout ancestor ever
 * changes size.
 */
export function QuickDispatchFlightDeck({ c }: { c: QuickDispatchController }) {
  const { quickT, tx } = c;
  const railMode: 'suggestions' | 'recent' =
    c.token && (c.suggestions.length > 0 || c.suggestionHint) ? 'suggestions' : 'recent';

  return (
    <div className="absolute inset-x-0 top-[12vh] flex justify-center px-6 pointer-events-none">
      <div
        ref={c.cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={quickT.title}
        className="pointer-events-auto animate-fade-slide-in w-full max-w-3xl h-[400px] glass-md rounded-modal shadow-elevation-4 overflow-hidden flex flex-col"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            c.closeQuickDispatch();
          }
        }}
      >
        {/* Header band — fixed height, subtle mission-pad gradient. */}
        <div className="h-10 shrink-0 flex items-center gap-2 px-3 border-b border-foreground/10 bg-gradient-to-r from-primary/10 via-transparent to-transparent">
          <Rocket className="w-4 h-4 text-primary" aria-hidden="true" />
          <span className="typo-label uppercase tracking-wider text-foreground">{quickT.title}</span>
          <button
            type="button"
            onClick={c.closeQuickDispatch}
            aria-label={quickT.close}
            className="ml-auto p-1 rounded-full text-foreground/70 hover:bg-secondary/60 hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-[1fr_264px]">
          {/* Composer pane — every row height is reserved; the input is pinned
              directly under the chip rail and can never be displaced. */}
          <div className="p-3 flex flex-col min-w-0">
            <div
              className="h-7 mb-1.5 flex items-center gap-1 overflow-x-auto"
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
                maxRows={5}
                busy={c.sending}
                disabled={c.sending}
                boxShadow={c.stateShadow}
                placeholder={quickT.placeholder}
                sendAriaLabel={quickT.send}
                inputTestId="quick-dispatch-input"
                sendTestId="quick-dispatch-send"
              />
            </div>

            <div className="mt-1.5">
              <QuickDispatchMetaLine c={c} />
            </div>

            <div className="flex-1" />

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={c.cycleModel}
                className={controlChipClass(c.model)}
                data-testid="quick-dispatch-model-chip"
              >
                {c.model ? tx(quickT.model_chip, { model: c.model }) : quickT.model_chip_unset}
              </button>
              <button
                type="button"
                onClick={c.cycleEffort}
                className={controlChipClass(c.effort)}
                data-testid="quick-dispatch-effort-chip"
              >
                {c.effort ? tx(quickT.effort_chip, { effort: c.effort }) : quickT.effort_chip_unset}
              </button>
              <div className="ml-auto flex items-center gap-1.5">
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

          {/* Context rail — the ONLY volatile region, swapping content inside
              its own fixed bounds. `key` remounts trigger the entry fade; the
              rail itself never changes size. */}
          <div className="border-l border-foreground/10 flex flex-col min-h-0 bg-secondary/20">
            <div className="h-8 shrink-0 flex items-center px-3 typo-caption uppercase tracking-wider text-foreground/70">
              {railMode === 'recent' ? quickT.recent_title : quickT.title}
            </div>
            <div
              key={railMode}
              className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 animate-fade-slide-in"
            >
              {railMode === 'suggestions' ? (
                <QuickDispatchSuggestions
                  listboxId={QUICK_DISPATCH_LISTBOX_ID}
                  items={c.suggestions}
                  activeIndex={c.activeIndex}
                  hint={c.suggestionHint}
                  onPick={c.pickSuggestion}
                  onHoverIndex={c.setActiveIndex}
                />
              ) : c.recent.length > 0 ? (
                <ul className="flex flex-col" data-testid="quick-dispatch-recent-list">
                  {c.recent.map((s) => (
                    <li key={s.id}>
                      <RecentDispatchRow c={c} session={s} />
                    </li>
                  ))}
                </ul>
              ) : !c.fleetSessionsLoading ? (
                <p className="px-1.5 pt-1 typo-caption text-foreground" data-testid="quick-dispatch-recent-empty">
                  {quickT.recent_empty}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
