import { memo, useMemo } from 'react';
import { ChevronDown, Wand2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { Collapse } from '@/features/shared/components/display/Collapse';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { PersonaStack, useAssignmentSteps, usePersonaIndex } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import { Engraved, Lamp, Segments } from '../grid/prototype/entry-e/parts';
import { clusterStatus } from './conversationModel';
import { RUN_LOOK, runOutcome, runState, type RunState } from './runOutcome';
import { RunSteps } from './RunSteps';

/* ----------------------------------------------------------------------------
 * RUN BAND - one assignment in the thread, OUTCOME FIRST (WP12).
 *
 * An `ae-win` window lit by the annunciator grammar. Line 1: the lamp and the
 * state word as an engraved eyebrow, then the step segments, the n/m figure,
 * the rework count, who worked it and when. Line 2, the title: what happened
 * (the step waiting on the operator, or the newest output). Line 3: the goal.
 * The steps, their outputs and Pause / Resume fold behind the chevron. A run
 * waiting on the operator says so in its eyebrow; its decision sits at the top
 * of the Needs you rail.
 * -------------------------------------------------------------------------- */

const SEG_TONE = { failed: 'err', waiting: 'warn', running: 'info', done: 'ok', pending: 'off' } as const;

function useStateWord(state: RunState): string {
  const m = useTranslation().t.monitor;
  return { failed: m.cv_run_failed, waiting: m.cv_run_waiting, running: m.cv_run_running, done: m.cv_run_done, pending: m.cv_run_pending }[state];
}

/** memo: `rowKey` + a keyed `onToggle` keep every prop stable, so opening one band re-renders that band only. */
export const RunBand = memo(function RunBand({ assignmentId, items, expanded, rowKey, onToggle }: {
  assignmentId: string;
  items: TeamChannelItem[];
  expanded: boolean;
  rowKey: string;
  onToggle: (key: string) => void;
}) {
  const { t, tx } = useTranslation();
  const personaIndex = usePersonaIndex();
  const label = clusterStatus(items);
  const { steps } = useAssignmentSteps(assignmentId, label === 'step_running' || label === 'created');
  const { state, outcome, personaIds, rework, done } = useMemo(() => ({
    state: runState(steps),
    outcome: runOutcome(steps),
    personaIds: steps.map((s) => s.assignedPersonaId),
    rework: steps.reduce((n, s) => n + (s.retryCount ?? 0), 0),
    done: steps.filter((s) => s.status === 'done').length,
  }), [steps]);
  const word = useStateWord(state);
  const look = RUN_LOOK[state];
  const goal = items[0]?.body ?? t.monitor.conv_card_assignment;

  return (
    <div className={`ae-win my-2 overflow-hidden rounded-card ${look.win}`} data-testid="conv-run" data-state={state}>
      <Button
        variant="ghost"
        size="sm"
        block
        onClick={() => onToggle(rowKey)}
        aria-expanded={expanded}
        className="justify-start! rounded-none px-3! py-2! text-left hover:bg-transparent [&>span]:flex [&>span]:w-full [&>span]:min-w-0 [&>span]:flex-col [&>span]:gap-1"
      >
        <span className="flex w-full min-w-0 items-center gap-2">
          <Lamp lamp={look} />
          <Engraved className="min-w-0 flex-1 truncate">{word}</Engraved>
          {steps.length > 0 && <Segments count={steps.length} lit={done} tone={SEG_TONE[state]} thin className="w-12 flex-shrink-0" />}
          <span className="typo-data tabular-nums text-foreground">{tx(t.monitor.conv_steps, { done, total: steps.length })}</span>
          {rework > 0 && <span className="typo-data tabular-nums text-status-warning">{tx(t.monitor.conv_rework, { count: rework })}</span>}
          <PersonaStack ids={personaIds} index={personaIndex} />
          <span className="typo-caption"><RelativeTime timestamp={items[items.length - 1]!.at} /></span>
          <ChevronDown className={`h-4 w-4 flex-shrink-0 text-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden />
        </span>
        <span className="line-clamp-2 typo-heading text-foreground [text-wrap:pretty]">{outcome ?? goal}</span>
        {outcome && (
          <span className="flex min-w-0 items-center gap-1.5 typo-caption">
            <Wand2 className="h-3.5 w-3.5 flex-shrink-0 text-status-info" aria-hidden />
            <span className="truncate">{goal}</span>
          </span>
        )}
      </Button>
      <Collapse open={expanded} unmountWhenClosed duration={180}>
        <RunSteps assignmentId={assignmentId} steps={steps} />
      </Collapse>
    </div>
  );
});
