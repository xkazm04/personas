import { useEffect, useState } from 'react';
import { Link2Off, ListChecks, Rocket, Sparkles, SquareTerminal, Target } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { Badge } from '@/features/shared/components/display/Badge';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { DevToolsProjectDropdown } from '@/features/plugins/dev-tools/components/DevToolsProjectDropdown';
import { useToastStore } from '@/stores/toastStore';
import type { DevNote } from '@/lib/bindings/DevNote';
import type { DevProject } from '@/lib/bindings/DevProject';

import { noteStatusMeta } from '../noteStatusMeta';
import type { NoteActions } from '../notepadActions';
import { reportSuggestionCount, startAsk, useNoteAsking } from '../notepadAskState';
import { noteAskBlockedReasonKey } from '../noteGuards';
import { useNotePlan } from '../plan/NotePlanContext';
import { NoteMilestonePicker } from './NoteMilestonePicker';

interface NoteDispatchBarProps {
  note: DevNote;
  /** Resolved project row. The bar renders the picker from `note.projectId`
   *  rather than this — it is here so the host passes ONE resolved shape to
   *  the bar and the body variants alike. */
  project: DevProject | null;
  onSelectProject: (project: DevProject) => void;
  actions: NoteActions;
  /** How many of Athena's suggestions are currently open on this note. The bar
   *  does not render them — it watches the number, because a rise is the only
   *  honest signal that an "Ask Athena" has been ANSWERED. */
  suggestionCount?: number;
}

/**
 * The bottom rail: where the note stops being a note.
 *
 * TWO SETS OF VERBS, because there are two rails (see `noteStatusMeta.ts`). A
 * `draft` can be handed to a runner, decomposed into goals, or PROMOTED into a
 * milestone's brief — that third verb is the fork. Once it is a brief the verbs
 * are the milestone's: decompose the brief, run `/ship-milestone`, cut the
 * scope, ship it. A shipped note has none: it is a record, and the only thing
 * left to do with a record is ask about it.
 *
 * What did NOT change is the shape. Every control is an `AsyncButton` (a real
 * spinner on the control the user pressed — the action half of the spinner
 * boundary), every refusal is a tooltip on the DISABLED control rather than an
 * error after the click, and `run()` reports a precondition with the same
 * sentence the tooltip carries.
 */
export function NoteDispatchBar({
  note,
  onSelectProject,
  actions,
  suggestionCount = 0,
}: NoteDispatchBarProps) {
  const { t, tx } = useTranslation();
  const plan = useNotePlan();
  const meta = noteStatusMeta(note.status);
  const StatusIcon = meta.Icon;
  const [focus, setFocus] = useState('');

  // ------------------------------------------------------------------
  // "Asking Athena" is a state, not an instant — and it belongs to the NOTE,
  // not to this bar. The wait lives in `notepadAskState` (keyed by note id,
  // with the 120 s ceiling and the three ways it ends), so the desk card's
  // presence chip reads the same answer and stepping back to the desk no
  // longer throws the wait away. Switching notes shows the other note's wait,
  // which is none unless she was asked about that one too.
  //
  // The bar still feeds the ONE signal it owns: the open-suggestion count the
  // host hands it. A rise past the count at the ask is the answer arriving.
  // ------------------------------------------------------------------
  const asking = useNoteAsking(note.id) !== null;

  useEffect(() => {
    reportSuggestionCount(note.id, suggestionCount);
  }, [note.id, suggestionCount]);

  const noProject = !note.projectId;
  const isDraft = note.status === 'draft';
  const scoped = note.status === 'scoped';
  const cut = note.status === 'cut';
  const shipped = note.status === 'shipped';
  /** The plan rail's WORKING states — a brief that can still change. */
  const onPlan = scoped || cut;

  // Athena writes nothing, so she is available wherever the note is READABLE as
  // itself. The rule is shared with the desk card's menu (`noteGuards.ts`).
  const askBlockedKey = noteAskBlockedReasonKey(note);
  const askBlocked = askBlockedKey !== null;
  /** The brainstorm rail's precondition pair, unchanged. */
  const dispatchBlocked = noProject || !isDraft;
  const blockedHint = noProject ? t.notepad.dispatch_needs_project : t.notepad.dispatch_needs_draft;
  const askHint = t.notepad[askBlockedKey ?? 'dispatch_needs_draft'];

  const runAsk = async () => {
    const baseline = suggestionCount;
    const result = await actions.askAthena(focus.trim() || undefined);
    if (!result.ok) {
      if (result.pending) useToastStore.getState().addToast(askHint, 'warning');
      return;
    }
    // Say so where the eye already is. The prompt lands in her chat, which may
    // not even be open; without this the only evidence of the click is a
    // button that re-enables.
    useToastStore.getState().addToast(t.notepad.ask_athena_sent, 'success');
    startAsk(note.id, baseline);
    setFocus('');
  };

  const run = async (fn: () => Promise<{ ok: boolean; pending?: boolean }>, hint = blockedHint) => {
    const result = await fn();
    if (!result.ok && result.pending) {
      // A precondition the bar ALREADY states on the disabled control. Reaching
      // here at all means the note changed under the click (the sweeper flipped
      // its status, another surface unmapped its project), so the honest thing
      // is the same sentence the tooltip carries — not a second vocabulary for
      // the same refusal. A real failure never lands here: `notepadActions`
      // reports those through `toastCatch`, which also reaches Sentry.
      useToastStore.getState().addToast(hint, 'warning');
    }
  };

  /** Wrap a disabled control so the tooltip still surfaces — a disabled button
   *  fires no pointer events of its own (see `Tooltip.triggerFocusable`). */
  const gated = (node: React.ReactNode, blocked: boolean, hint: string) =>
    blocked ? (
      <Tooltip content={hint} triggerFocusable triggerClassName="inline-flex">
        <span className="pointer-events-none inline-flex">{node}</span>
      </Tooltip>
    ) : (
      node
    );

  // The cut's gate. `nogo` is the one verdict that refuses outright; `warn` and
  // `setup` are readings the operator is allowed to overrule, and the badge
  // beside the button says how many criteria are unmet either way.
  // Same admission rule as `ShipControlBar` (`verdict !== 'go'`): one
  // transition, one gate, whichever surface you stand on. `warn` and `setup`
  // are not overrulable from the pad any more than from the Ship tab.
  const shipBlocked = !plan || plan.verdict !== 'go';
  const shipHint = plan && plan.unmet > 0
    ? tx(t.notepad.ship_blocked_criteria, { unmet: plan.unmet, total: plan.totalCriteria })
    : t.notepad.ship_blocked_criteria_none;

  return (
    <div className="flex items-center gap-3 px-5 py-3 border-t border-primary/10 bg-background/80">
      <div className="w-64 flex-shrink-0">
        <DevToolsProjectDropdown
          value={note.projectId}
          onSelect={onSelectProject}
          placeholder={t.notepad.project_none}
          // 16rem of trigger: a root path here truncates the project's NAME
          // out of view, which is the one thing the control exists to show.
          showPath={false}
        />
      </div>

      <Badge variant={meta.badgeVariant} size="sm">
        <StatusIcon className="w-3 h-3" aria-hidden />
        {meta.labelKey(t)}
      </Badge>

      <div className="flex-1 min-w-0">
        <input
          type="text"
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          placeholder={t.notepad.ask_athena_placeholder}
          aria-label={t.notepad.ask_athena_placeholder}
          data-testid="notepad-athena-focus"
          className="w-full px-3 py-2 typo-body rounded-input border border-primary/15 bg-background/60 text-foreground placeholder:text-foreground/60 focus:outline-none focus:border-primary/30"
        />
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {gated(
          <AsyncButton
            variant="secondary"
            size="sm"
            disabled={askBlocked}
            isLoading={asking}
            loadingText={t.notepad.ask_athena_pending}
            icon={<Sparkles className="w-3.5 h-3.5" />}
            data-testid="notepad-ask-athena"
            onClick={runAsk}
          >
            {t.notepad.ask_athena}
          </AsyncButton>,
          askBlocked,
          askHint,
        )}

        {/* --- the brainstorm rail: a draft that has not been promoted --- */}
        {!onPlan && !shipped && (
          <>
            {gated(
              <AsyncButton
                variant="primary"
                size="sm"
                disabled={dispatchBlocked}
                icon={<Rocket className="w-3.5 h-3.5" />}
                data-testid="notepad-publish-fleet"
                onClick={() => run(actions.publishFleet)}
              >
                {t.notepad.execute}
              </AsyncButton>,
              dispatchBlocked,
              blockedHint,
            )}
            {gated(
              <AsyncButton
                variant="secondary"
                size="sm"
                disabled={dispatchBlocked}
                icon={<Target className="w-3.5 h-3.5" />}
                data-testid="notepad-to-goals"
                onClick={() => run(actions.toGoals)}
              >
                {t.notepad.to_goals}
              </AsyncButton>,
              dispatchBlocked,
              blockedHint,
            )}
            {/* The fork. Offered on a draft only: promoting a note that has
                already been handed to a runner would give one body two owners. */}
            {gated(
              <NoteMilestonePicker
                projectId={note.projectId}
                disabled={dispatchBlocked}
                onPick={(milestoneId) => void run(() => actions.link(milestoneId), t.notepad.link_needs_project)}
                onCreate={() => void run(actions.promote, t.notepad.link_needs_project)}
              />,
              dispatchBlocked,
              noProject ? t.notepad.link_needs_project : blockedHint,
            )}
          </>
        )}

        {/* --- the plan rail: this note IS a milestone's brief --- */}
        {onPlan && (
          <>
            <AsyncButton
              variant="secondary"
              size="sm"
              disabled={!plan?.vm}
              icon={<ListChecks className="w-3.5 h-3.5" />}
              data-testid="notepad-decompose"
              onClick={async () => plan?.decompose()}
            >
              {t.notepad.decompose_brief}
            </AsyncButton>

            <Tooltip content={t.notepad.execute_milestone_hint}>
              <AsyncButton
                variant="primary"
                size="sm"
                disabled={!plan?.vm}
                isLoading={plan?.executing ?? false}
                icon={<SquareTerminal className="w-3.5 h-3.5" />}
                data-testid="notepad-execute-milestone"
                // `plan.execute()` not `void plan.execute()`: AsyncButton
                // disarms double-submit by awaiting the promise its onClick
                // returns, and `void` throws that promise away.
                onClick={() => plan?.execute() ?? Promise.resolve()}
              >
                {t.notepad.execute}
              </AsyncButton>
            </Tooltip>

            {/* Cutting FREEZES the scope; it is never gated on the criteria,
                which are measured AGAINST the cut. Shipping is the gated act. */}
            {scoped && (
              <AsyncButton
                variant="secondary"
                size="sm"
                disabled={!plan?.vm}
                icon={<Rocket className="w-3.5 h-3.5" />}
                data-testid="notepad-certify-cut"
                onClick={async () => plan?.openCertify()}
              >
                {t.notepad.certify_cut}
              </AsyncButton>
            )}

            {cut && gated(
              <AsyncButton
                variant="primary"
                size="sm"
                disabled={shipBlocked}
                icon={<Rocket className="w-3.5 h-3.5" />}
                data-testid="notepad-ship"
                onClick={async () => plan?.openCertify()}
              >
                {t.notepad.ship}
                {plan && plan.unmet > 0 && (
                  <span className="ml-1 px-1.5 rounded-full typo-data tabular-nums bg-secondary/60 text-foreground/80">
                    {plan.totalCriteria - plan.unmet}/{plan.totalCriteria}
                  </span>
                )}
              </AsyncButton>,
              shipBlocked,
              shipHint,
            )}

            {/* Unlink is `scoped`-only. After a cut the note is the RECORD of
                what was cut, and orphaning that record is not an undo. */}
            {scoped && (
              <AsyncButton
                variant="ghost"
                size="sm"
                icon={<Link2Off className="w-3.5 h-3.5" />}
                data-testid="notepad-unlink"
                onClick={() => run(actions.unlink, t.notepad.milestone_unlink_blocked)}
              >
                {t.notepad.milestone_unlink}
              </AsyncButton>
            )}
          </>
        )}
      </div>
    </div>
  );
}
