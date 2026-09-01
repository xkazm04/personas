/**
 * DeckDispatchBar — the Run Desk's action row, at rail width.
 *
 * Migrated from `plugins/dev-tools/sub_runner/RunDeskControls.tsx`, which is a
 * horizontal `ActionRow` of six buttons across a full-width page. This rail is
 * `clamp(18rem, …, 36rem)` — at its floor that row would wrap into six lines of
 * one button each. So the SHAPE is different and the ACTIONS are the same three
 * the Run Desk had for a selection: one at a time, the runner's default, or a
 * width you name. See {@link useAcceptedDispatch} for what each maps to.
 *
 * ## Fitting the rail (2026-09-01)
 *
 * The bar is hosted in two rails now — the deck's, and the Activity board's,
 * whose floor is narrower. Three things were sized for neither:
 *
 *  • The dispatch button was `accent`/amber. Amber is not a colour either
 *    rail uses for anything else, so the one control that should read as "the
 *    primary act here" instead read as "a warning about something". It is the
 *    `primary` variant now, which is what a primary action is.
 *  • The concurrency stepper was full-width-flexible beside a `flex-1`
 *    button, so at rail floor the two fought over the same row and the button
 *    lost its label. It has a fixed compact width now, and the row it shares
 *    is aligned rather than stretched.
 *  • `PillGroup` paints its labels in monospace micro-type, which is the
 *    right call in the numeric surfaces it was built for and a foreign object
 *    in a panel that is `typo-*` throughout. The bar passes `typo-label`.
 *
 * Three deliberate omissions, none of them oversights:
 *  • "New task" — this bar acts on a selection of ideas the reviewer just
 *    accepted; authoring a task from nothing is not a triage act.
 *  • "Batch from accepted" — that button IS this whole surface, minus the
 *    ability to choose. Select-all + Dispatch is the same thing with a look at
 *    what you are sending.
 *  • "Cancel all" / "Retry failed" — those operate on tasks that already exist,
 *    which is the Run Desk's own subject, not the deck's.
 *
 * ONE ADDITION the Run Desk never had: a trash beside the selection count. This
 * tab drains the "accepted but never became work" pile, and dispatch only
 * drains it in the direction of yes. A reviewer who had changed their mind
 * about eleven things had no exit here at all, so the ideas stayed `accepted`
 * with no task forever — precisely the limbo the tab was built to empty. It is
 * deliberately an ICON beside the count rather than a second button beside
 * Dispatch: the two acts are not peers, and a destructive control the same size
 * and shape as the primary one is how the wrong one gets pressed.
 */
import { useState } from 'react';
import { Rocket, Trash2 } from 'lucide-react';

import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { NumberStepper } from '@/features/shared/components/forms/NumberStepper';
import { PillGroup, type PillOption } from '@/features/shared/components/forms/PillGroup';
import { useTranslation } from '@/i18n/useTranslation';

import {
  MAX_PARALLEL,
  MIN_PARALLEL,
  type AcceptedDispatch,
  type DispatchMode,
} from './useAcceptedDispatch';

export function DeckDispatchBar({ ctl }: { ctl: AcceptedDispatch }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  // The confirm gate is bar-local: nothing outside needs to know it is open,
  // and the hook deliberately does not ask — `remove()` just deletes.
  const [confirming, setConfirming] = useState(false);

  const total = ctl.rows.length;
  const chosen = ctl.selected.size;
  const allSelected = total > 0 && chosen === total;

  // A RADIO GROUP, not a tab strip. The three modes select a parameter, not a
  // region — nothing on this bar is a `tabpanel`, and `SegmentedTabs` would
  // have this row telling assistive tech it controls three panels that do not
  // exist (census: `tabstrip-with-no-declared-panel`). `PillGroup` declares
  // `role="radiogroup"` / `role="radio"`, which is what this actually is.
  const modes: PillOption<DispatchMode>[] = [
    { value: 'single', label: m.triage_accepted_mode_single },
    { value: 'batch', label: m.triage_accepted_mode_batch },
    { value: 'parallel', label: m.triage_accepted_mode_parallel },
  ];

  return (
    <div className="shrink-0 space-y-1.5 border-b border-border px-2.5 py-2">
      <div className="flex items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 typo-label text-foreground">
          <input
            type="checkbox"
            checked={allSelected}
            disabled={total === 0}
            // `indeterminate` is a PROPERTY, not an attribute — React will not
            // set it from JSX, so a partial selection reads as "none selected"
            // without this ref.
            ref={(el) => { if (el) el.indeterminate = chosen > 0 && !allSelected; }}
            onChange={ctl.toggleAll}
            className="h-3.5 w-3.5 cursor-pointer rounded border-primary/30 bg-secondary/30 accent-primary"
          />
          {m.triage_accepted_select_all}
        </label>
        <span className="ml-auto typo-label tabular-nums text-foreground">
          {tx(m.triage_accepted_selected, { count: chosen })}
        </span>
        {/* Not an `AsyncButton`: pressing this opens a DIALOG, it does not start
            the delete. The in-flight control is the dialog's own Confirm, which
            disables itself and its sibling while `remove()` is pending. */}
        <Tooltip content={m.triage_accepted_delete}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={m.triage_accepted_delete}
            disabled={chosen === 0 || ctl.dispatching || ctl.removing}
            onClick={() => setConfirming(true)}
            className="shrink-0 text-foreground hover:bg-status-error/10 hover:text-status-error"
            icon={<Trash2 className="h-3.5 w-3.5" />}
          />
        </Tooltip>
      </div>

      {/* The gate. This is a hard `DELETE FROM dev_ideas` with no undo anywhere
          in the app, so it is confirmed even though the rows are on screen and
          the reviewer just ticked them. `danger` styling, and a body that says
          what actually goes (the idea AND the record that it was accepted)
          rather than the usual "are you sure?". */}
      {confirming && (
        <ConfirmDialog
          danger
          title={tx(m.triage_accepted_delete_title, { count: chosen })}
          body={m.triage_accepted_delete_body}
          confirmLabel={m.triage_accepted_delete_confirm}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            await ctl.remove();
            setConfirming(false);
          }}
        />
      )}

      <Tooltip content={m.triage_accepted_concurrency_hint}>
        <div aria-label={m.triage_accepted_mode_aria} className="flex">
          {/* Full width so the three modes divide the rail evenly instead of
              huddling at its left edge under a full-width button. */}
          <PillGroup
            options={modes}
            value={ctl.mode}
            onChange={ctl.setMode}
            labelClass="typo-label"
          />
        </div>
      </Tooltip>

      <div className="flex items-center gap-1.5">
        {/* Only in `parallel`: in the other two modes the width is not the
            reviewer's to set (1, and the runner's own default), and a stepper
            that does nothing is worse than no stepper.

            FIXED WIDTH, not flexible. Sharing a row with a `flex-1` button, a
            stepper that grows takes the label off the button at rail floor —
            and the field only ever holds one digit. */}
        {ctl.mode === 'parallel' && (
          <NumberStepper
            value={ctl.maxParallel}
            onChange={(n) => ctl.setMaxParallel(n ?? MIN_PARALLEL)}
            min={MIN_PARALLEL}
            max={MAX_PARALLEL}
            ariaLabel={m.triage_accepted_concurrency_hint}
            className="w-[74px] shrink-0"
          />
        )}
        {/* An ACTION, so a real spinner on the control the reviewer pressed —
            `AsyncButton` with a promise-returning onClick, never a `useState`
            busy flag (docs/concepts/golden-paths/inline-busy-state.md). */}
        <AsyncButton
          variant="primary"
          size="sm"
          className="flex-1"
          icon={<Rocket className="h-3.5 w-3.5" />}
          disabled={chosen === 0}
          onClick={() => ctl.dispatch()}
        >
          {m.triage_accepted_dispatch}
        </AsyncButton>
      </div>

      {/* The outcome of whichever act ran last, until the next one clears it.
          Both branches print the partial result BESIDE the successful one and
          never folded into it — an act that half worked must not read as one
          that worked. */}
      {ctl.report && (
        <button
          type="button"
          onClick={ctl.dismissReport}
          className={`focus-ring block w-full rounded-interactive px-2 py-1 text-left typo-caption ${
            ctl.report.error
              ? 'bg-status-error/10 text-status-error'
              : 'bg-status-success/10 text-status-success'
          }`}
        >
          {ctl.report.error ??
            (ctl.report.kind === 'dispatch' ? (
              <>
                {tx(m.triage_accepted_result, { count: ctl.report.dispatched })}
                {ctl.report.skipped > 0 && (
                  <span className="text-status-warning">
                    {' · '}
                    {tx(m.triage_accepted_result_skipped, { count: ctl.report.skipped })}
                  </span>
                )}
              </>
            ) : (
              <>
                {tx(m.triage_accepted_deleted, { count: ctl.report.removed })}
                {/* Something else got there first — this app runs several
                    sessions against one database, and a delete that found less
                    than it asked for is a fact, not a rounding error. */}
                {ctl.report.requested > ctl.report.removed && (
                  <span className="text-status-warning">
                    {' · '}
                    {tx(m.triage_accepted_deleted_gone, {
                      count: ctl.report.requested - ctl.report.removed,
                    })}
                  </span>
                )}
              </>
            ))}
        </button>
      )}
    </div>
  );
}
