import { ChatInputBar } from '@/features/shared/components/forms/ChatInputBar';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import {
  QuickDispatchSuggestions,
} from './QuickDispatchSuggestions';
import { QUICK_DISPATCH_LISTBOX_ID, type QuickDispatchController } from './quickDispatchController';
import {
  QuickDispatchChips,
  QuickDispatchMetaLine,
  RecentDispatchRow,
  controlChipClass,
} from './QuickDispatchParts';

/**
 * BASELINE — the shipped layout, kept verbatim for A/B reference. Top-anchored
 * centered card, content-sized; the recent list and suggestion panel live IN
 * FLOW above the input, which is exactly what produces the height-shake the
 * variants exist to cure. Do not fix it here — it is the control sample.
 */
export function QuickDispatchBaseline({ c }: { c: QuickDispatchController }) {
  const { quickT, tx } = c;
  return (
    <div
      ref={c.cardRef}
      role="dialog"
      aria-modal="true"
      aria-label={quickT.title}
      className="animate-fade-slide-in relative w-full max-w-lg glass-md rounded-modal shadow-elevation-4 p-3"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          c.closeQuickDispatch();
        }
      }}
    >
      {c.recent.length > 0 ? (
        <div className="mb-2">
          <div className="px-1 pb-1 typo-caption text-primary">{quickT.recent_title}</div>
          <ul className="flex flex-col" data-testid="quick-dispatch-recent-list">
            {c.recent.map((s) => (
              <li key={s.id}>
                <RecentDispatchRow c={c} session={s} />
              </li>
            ))}
          </ul>
          <div className="mt-2 mb-2 border-t border-foreground/10" />
        </div>
      ) : !c.fleetSessionsLoading ? (
        <p className="px-1 pb-2 typo-caption text-foreground" data-testid="quick-dispatch-recent-empty">
          {quickT.recent_empty}
        </p>
      ) : null}

      <div onKeyDownCapture={c.onComposerKeyDownCapture}>
        {(c.projectChip || c.skillChip) && (
          <div className="mb-1.5 flex flex-wrap items-center gap-1" data-testid="quick-dispatch-chips">
            <QuickDispatchChips c={c} />
          </div>
        )}

        {c.token && (c.suggestions.length > 0 || c.suggestionHint) && (
          <div className="mb-1.5">
            <QuickDispatchSuggestions
              listboxId={QUICK_DISPATCH_LISTBOX_ID}
              items={c.suggestions}
              activeIndex={c.activeIndex}
              hint={c.suggestionHint}
              onPick={c.pickSuggestion}
              onHoverIndex={c.setActiveIndex}
            />
          </div>
        )}

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

      <div className="mt-2 flex flex-wrap items-center gap-2">
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

      <QuickDispatchMetaLine c={c} />
    </div>
  );
}
