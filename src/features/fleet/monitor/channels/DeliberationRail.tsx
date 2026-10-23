import { useEffect, useMemo } from 'react';
import { GitBranch, Merge, Play, SkipForward, Square } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Branch } from '@/features/decision-center/deck/DeckDock';
import { digitOf, isTypingTarget, plain } from '@/features/decision-center/deck/keys';
import { useAppKeyboard, ROUTE_DECISION_PRIORITY } from '@/lib/keyboard/AppKeyboardProvider';
import { useTeamDeliberations } from '@/features/teams/sub_deliberations/useTeamDeliberations';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import '@/features/decision-center/deck/aurora.css';
import { Engraved, Lamp } from '../grid/prototype/entry-e/parts';
import { DeliberationDecisions, type PendingAction } from './DeliberationDecisions';
import { deliberationLook, deliberationStatusLabel, type DeliberationProposal } from './deliberationStatus';

/* ----------------------------------------------------------------------------
 * DELIBERATION RAIL - the driven deliberation's controls (plan D1, WP12).
 *
 * The thread shows a deliberation as a band; its machinery lives HERE, which
 * is what let `sub_deliberations/DeliberationsPane` be deleted: advance, run
 * to budget and stop, split / run all tracks / merge, the gated capability,
 * the escalation decision, proposal to assignment, the agenda. Drawn in the
 * dock's grammar: one state head (lamp, status, topic, round and the spend
 * meter), every run control a deck `Branch` with its digit, the agenda as
 * lamp rows. Engine-written JSON is parsed once and never thrown from.
 * -------------------------------------------------------------------------- */

const icon = (I: typeof Play) => <I className="h-4 w-4" aria-hidden />;

export function DeliberationRail({ teamId, deliberationId, keys = false }: { teamId: string; deliberationId: string; keys?: boolean }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const d = useTeamDeliberations(teamId);
  // Depend on the SETTER: `d` changes identity on every poll tick.
  const { setSelectedId } = d;
  useEffect(() => { setSelectedId(deliberationId); }, [deliberationId, setSelectedId]);
  const detail = d.detail;
  const pending = useMemo(() => parseJsonOrDefault<PendingAction | null>(detail?.pendingAction, null), [detail?.pendingAction]);
  const proposal = useMemo(() => parseJsonOrDefault<DeliberationProposal | null>(detail?.resolution, null), [detail?.resolution]);
  const terminal = detail ? ['resolved', 'aborted'].includes(detail.status) : true;

  const controls = useMemo(() => {
    if (terminal) return [];
    const list = [
      { label: m.delib_advance, icon: icon(Play), run: () => { if (!d.advancing) void d.advance(deliberationId); } },
      d.running
        ? { label: m.delib_stop, icon: icon(Square), run: () => d.stopRun() }
        : { label: m.delib_run_budget, icon: icon(SkipForward), run: () => { if (!d.advancing) void d.runToBudget(deliberationId); } },
      { label: m.delib_split, icon: icon(GitBranch), run: () => { if (!d.trackBusy) void d.split(deliberationId); } },
    ];
    if (d.tracks.length > 0) {
      list.push(
        { label: m.delib_run_tracks, icon: icon(Play), run: () => { if (!d.trackBusy) void d.runAllTracks(deliberationId); } },
        { label: m.delib_merge, icon: icon(Merge), run: () => { if (!d.trackBusy) void d.merge(deliberationId); } },
      );
    }
    return list;
  }, [terminal, d, deliberationId, m]);

  useAppKeyboard((e) => {
    if (isTypingTarget(e.target) || !plain(e) || e.shiftKey || document.querySelector('[role="dialog"]')) return false;
    const c = controls[(digitOf(e) ?? 0) - 1];
    if (!c) return false;
    c.run();
    e.preventDefault();
    return true;
  }, { enabled: keys, priority: ROUTE_DECISION_PRIORITY });

  if (!detail) return <p className="p-2 typo-caption">{m.delib_loading}</p>;
  const spent = Number(detail.costSpentUsd ?? 0);
  const budget = Number(detail.costBudgetUsd ?? 5);
  const share = budget > 0 ? Math.min(1, spent / budget) : 0;

  return (
    <div className="au-scope flex flex-col gap-3" data-testid="deliberation-rail">
      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-2">
          <Lamp lamp={deliberationLook(detail.status).lamp} />
          <Engraved>{m.conv_card_deliberation} · {deliberationStatusLabel(t, detail.status)}</Engraved>
        </span>
        <span className="typo-heading text-foreground">{detail.topic}</span>
        <span className="mt-1 flex items-center gap-3">
          <span className="typo-data tabular-nums text-foreground">{tx(m.delib_round, { round: Number(detail.round) })}</span>
          <span className={`ae-bar ${share > 0.8 ? 'ae-t-warn' : 'ae-t-agent'} min-w-0 flex-1`} aria-hidden><i style={{ width: `${share * 100}%` }} /></span>
          <span className="typo-data tabular-nums text-foreground"><Numeric value={spent} precision={2} /> / <Numeric value={budget} precision={2} /></span>
        </span>
      </div>
      {controls.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {controls.map((c, i) => <Branch key={c.label} k={String(i + 1)} label={c.label} icon={c.icon} accent={i === 0} onClick={c.run} />)}
        </div>
      )}
      <DeliberationDecisions d={d} detail={detail} id={deliberationId} pending={pending} proposal={proposal} />
      {d.agenda.length > 0 && (
        <div className="flex flex-col gap-1">
          <Engraved>{m.delib_agenda}</Engraved>
          {d.agenda.map((a) => (
            <span key={a.id} className="flex items-start gap-2 typo-body text-foreground">
              <Lamp lamp={{ tone: a.status === 'resolved' ? 'ok' : 'off', lit: false }} className="mt-1.5" />
              <span className={a.status === 'resolved' ? 'line-through decoration-foreground/40' : ''}>{a.item}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
