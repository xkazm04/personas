// DockCommandRow — the one row the operator asked for: "single row for input
// and button dispatch".
//
// Everything that CONFIGURES a dispatch is in the toolbar above. What is left
// here is the objective and the launch, side by side on one line, with the
// character budget between them because it is a property of the objective and
// nothing else.
//
// ## The half of the anti-shake contract that lives in this file
//
// The field grows from one line to `FIELD_MAX_PX` and then SCROLLS, inside a
// well whose own height is a literal class and never changes. Measured across
// collapsed -> typed -> typeahead-open -> long-objective, the well is the same
// box every time, so the rows below it — and the whole board above the dock —
// cannot move while the operator types.
//
// The launch is the shared `Button` (its busy state is the shared spinner and
// `aria-busy`, never a hand-rolled one) and its icon and its label sit on ONE
// line. The previous shell stacked them in a `flex-col`, which is exactly the
// split the operator ruled out.

import type { ReactNode } from 'react';
import { ArrowUp } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { QuickDispatchChips, QuickDispatchMetaLine } from '@/features/plugins/fleet/quick-dispatch/QuickDispatchParts';

import { FIELD_MIN_PX, OBJECTIVE_MAX, type DockConsole } from './useDockConsole';

/** The command well's reserved box. A literal, shared by all three variants. */
export const DECK_HEIGHT = 'h-[66px]';

export function DockCommandRow({
  console: d,
  frameClassName = '',
}: {
  console: DockConsole;
  /** A variant's own framing for the well. Never its height. */
  frameClassName?: string;
}) {
  const { c, firing, fieldRef, submit } = d;
  return (
    <div className="relative z-[1] px-3" data-dock-row onKeyDownCapture={c.onComposerKeyDownCapture}>
      <div
        data-dock-deck
        className={`flex ${DECK_HEIGHT} items-stretch gap-2 rounded-card border p-2 transition-[border-color,box-shadow,background] ${
          c.sending
            ? 'border-status-info/55 bg-status-info/[0.06]'
            : `border-card-border bg-foreground/[0.03] focus-within:border-primary/55 focus-within:shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_30%,transparent),inset_0_0_22px_color-mix(in_srgb,var(--primary)_7%,transparent)] ${frameClassName}`
        }`}
      >
        <div className="flex min-w-0 flex-1 items-start">
          <textarea
            ref={fieldRef}
            value={c.value}
            onChange={(e) => c.setValue(e.target.value)}
            onKeyDown={(e) => {
              // The capture handler above has already consumed Enter while a
              // typeahead token is open, so reaching here means the operator
              // is finishing a plain objective.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            disabled={c.sending}
            maxLength={OBJECTIVE_MAX}
            rows={1}
            placeholder={c.quickT.input_placeholder}
            data-testid="quick-dispatch-input"
            className="typo-body w-full resize-none border-0 bg-transparent p-0 text-foreground outline-none placeholder:text-muted"
            style={{ height: FIELD_MIN_PX }}
          />
        </div>

        {/* The budget. The server bound is 1200 and the operator used to meet
            it only as an error after pressing send. */}
        <span
          className={`typo-code flex-shrink-0 self-end tabular-nums ${
            c.value.length > OBJECTIVE_MAX ? 'text-status-error' : 'text-muted'
          }`}
          data-testid="quick-dispatch-char-count"
        >
          {c.value.length}
        </span>

        <Button
          variant="primary"
          onClick={submit}
          disabled={!c.canSend}
          loading={c.sending}
          icon={!c.sending ? <ArrowUp className="h-[18px] w-[18px]" aria-hidden /> : undefined}
          aria-label={c.quickT.send}
          data-testid="quick-dispatch-send"
          className={`typo-label dock-launch-flare relative w-[104px] flex-shrink-0 items-center justify-center self-stretch overflow-hidden rounded-input border !px-0 ${
            firing ? 'dock-launch-firing' : ''
          } ${
            c.canSend
              ? 'border-primary/60 bg-gradient-to-b from-accent to-btn-primary text-btn-primary-fg shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_25%,transparent),0_6px_18px_color-mix(in_srgb,var(--primary)_22%,transparent)] hover:brightness-110'
              : 'border-card-border bg-card-bg text-muted'
          }`}
        >
          <span>{c.quickT.send}</span>
        </Button>
      </div>
    </div>
  );
}

/** ALWAYS mounted at a fixed height, chips or empty — the rail cannot appear. */
export function DockChipRail({ console: d }: { console: DockConsole }) {
  return (
    <div
      className="relative z-[1] flex h-6 items-center gap-1 overflow-x-auto px-3"
      data-dock-row
      data-testid="quick-dispatch-chips"
    >
      <QuickDispatchChips c={d.c} />
    </div>
  );
}

/** The reserved swap slot: headless caption / error / success, never a mount. */
export function DockMetaRow({ console: d, children }: { console: DockConsole; children?: ReactNode }) {
  return (
    <div className="relative z-[1] flex h-5 min-w-0 items-center gap-2 px-3" data-dock-row>
      <div className="min-w-0 flex-1">
        <QuickDispatchMetaLine c={d.c} />
      </div>
      {children}
    </div>
  );
}
