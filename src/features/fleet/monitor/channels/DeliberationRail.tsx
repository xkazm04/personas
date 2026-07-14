import { useEffect, useState } from 'react';
import { CheckCircle2, CircleDot, GitBranch, Merge, Play, SkipForward, Square, Wand2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { usePersonaIndex } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import { useTeamDeliberations } from '@/features/teams/sub_deliberations/useTeamDeliberations';

/* ----------------------------------------------------------------------------
 * DELIBERATION RAIL — the focused deliberation's controls (plan D1).
 *
 * The conversation shows a deliberation as a CARD: topic, status, round, cost,
 * turns. What it deliberately does NOT show is the machinery — because a card
 * that also carried advance / run-to-budget / split / merge / escalation would
 * be a dashboard wedged into a chat, which is exactly what Briefing's thesis
 * rejects. Focus a deliberation and the machinery appears HERE.
 *
 * This is what lets `sub_deliberations/DeliberationsPane` be deleted without
 * losing anything: every control it had — advance, run-to-budget + stop,
 * parallel-track split/merge, the gated capability approve/skip, the escalation
 * decision, and proposal → assignment — lives in this rail.
 * -------------------------------------------------------------------------- */

export function DeliberationRail({ teamId, deliberationId }: { teamId: string; deliberationId: string }) {
  const { t, tx } = useTranslation();
  const personaIndex = usePersonaIndex();
  const d = useTeamDeliberations(teamId);
  const [note, setNote] = useState('');

  // Focusing a card in the conversation selects it in the hook, which is what
  // loads its agenda / tracks / pending action.
  useEffect(() => {
    d.setSelectedId(deliberationId);
  }, [deliberationId, d]);

  const detail = d.detail;
  if (!detail) {
    return <p className="typo-caption text-foreground opacity-45 p-2">{t.monitor.delib_loading}</p>;
  }

  const spent = Number(detail.costSpentUsd ?? 0);
  const budget = Number(detail.costBudgetUsd ?? 5);
  const pending = detail.pendingAction ? JSON.parse(detail.pendingAction) as {
    persona_id?: string; use_case_id?: string; rationale?: string;
  } : null;
  const proposal = detail.resolution ? JSON.parse(detail.resolution) as {
    title?: string; objective?: string; summary?: string;
  } : null;
  const terminal = ['resolved', 'aborted'].includes(detail.status);

  const btn = 'inline-flex items-center gap-1 px-2 py-1 rounded-interactive border border-border typo-caption text-foreground hover:bg-secondary/40 transition-colors disabled:opacity-40';

  return (
    <div className="space-y-3">
      <div>
        <p className="typo-body font-medium text-foreground">{detail.topic}</p>
        <p className="typo-caption text-foreground opacity-50 mt-0.5">
          {detail.status} · {tx(t.monitor.delib_round, { round: Number(detail.round) })} ·{' '}
          <Numeric value={spent} precision={2} /> / <Numeric value={budget} precision={2} />
        </p>
      </div>

      {/* Run controls — a deliberation is bounded by BUDGET, not by turn count. */}
      {!terminal && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className={btn} disabled={d.advancing} onClick={() => void d.advance(deliberationId)}>
            <Play className="w-3 h-3" /> {t.monitor.delib_advance}
          </button>
          {d.running ? (
            <button type="button" className={btn} onClick={() => d.stopRun()}>
              <Square className="w-3 h-3" /> {t.monitor.delib_stop}
            </button>
          ) : (
            <button type="button" className={btn} disabled={d.advancing} onClick={() => void d.runToBudget(deliberationId)}>
              <Play className="w-3 h-3" /> {t.monitor.delib_run_budget}
            </button>
          )}
          <button type="button" className={btn} disabled={d.trackBusy} onClick={() => void d.split(deliberationId)}>
            <GitBranch className="w-3 h-3" /> {t.monitor.delib_split}
          </button>
          {d.tracks.length > 0 && (
            <>
              <button type="button" className={btn} disabled={d.trackBusy} onClick={() => void d.runAllTracks(deliberationId)}>
                <Play className="w-3 h-3" /> {t.monitor.delib_run_tracks}
              </button>
              <button type="button" className={btn} disabled={d.trackBusy} onClick={() => void d.merge(deliberationId)}>
                <Merge className="w-3 h-3" /> {t.monitor.delib_merge}
              </button>
            </>
          )}
        </div>
      )}

      {/* Gated capability — a persona asked to DO something; the human decides. */}
      {pending && (
        <div className="rounded-card border border-amber-400/30 bg-amber-400/[0.07] p-2">
          <p className="typo-caption text-amber-300 font-medium mb-1">{t.monitor.delib_capability}</p>
          <p className="typo-caption text-foreground opacity-80">
            {personaIndex.get(pending.persona_id ?? '')?.name.replace(/^T:\s*/, '') ?? pending.persona_id}
            {pending.rationale ? ` — ${pending.rationale}` : ''}
          </p>
          <div className="flex items-center gap-1.5 mt-1.5">
            <button type="button" className={btn} disabled={d.actionBusy} onClick={() => void d.approveAction(deliberationId)}>
              <CheckCircle2 className="w-3 h-3" /> {t.monitor.delib_approve_run}
            </button>
            <button type="button" className={btn} disabled={d.actionBusy} onClick={() => void d.skipAction(deliberationId)}>
              <SkipForward className="w-3 h-3" /> {t.monitor.delib_skip}
            </button>
          </div>
        </div>
      )}

      {/* Escalation — the team is stuck and wants a decision. */}
      {detail.status === 'escalated' && (
        <div className="rounded-card border border-status-warning/30 bg-status-warning/[0.07] p-2">
          <p className="typo-caption text-status-warning font-medium mb-1">{t.monitor.delib_escalated}</p>
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t.monitor.delib_decision_placeholder}
            className="w-full px-2 py-1 rounded-input bg-secondary/30 border border-border typo-caption text-foreground placeholder:text-foreground/35 focus:outline-none focus:border-primary/40 resize-none"
          />
          <div className="flex items-center gap-1.5 mt-1.5">
            <button type="button" className={btn} disabled={d.decisionBusy} onClick={() => void d.resolveEscalation(deliberationId, 'resume', note)}>
              {t.monitor.delib_resume}
            </button>
            <button type="button" className={btn} disabled={d.decisionBusy} onClick={() => void d.resolveEscalation(deliberationId, 'resolve', note)}>
              {t.monitor.delib_resolve}
            </button>
            <button type="button" className={btn} disabled={d.decisionBusy} onClick={() => void d.resolveEscalation(deliberationId, 'abort', note)}>
              {t.monitor.delib_abort}
            </button>
          </div>
        </div>
      )}

      {/* The payoff — a deliberation that converged becomes real work. */}
      {proposal?.title && (
        <div className="rounded-card border border-status-success/30 bg-status-success/[0.07] p-2">
          <p className="typo-caption text-status-success font-medium mb-1">{t.monitor.delib_proposal}</p>
          <p className="typo-caption text-foreground font-medium">{proposal.title}</p>
          {proposal.summary && <p className="typo-caption text-foreground opacity-75 mt-0.5">{proposal.summary}</p>}
          {!detail.spawnedAssignmentId && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <button type="button" className={btn} onClick={() => void d.approve(deliberationId)}>
                <Wand2 className="w-3 h-3" /> {t.monitor.delib_approve_run}
              </button>
              <button type="button" className={btn} onClick={() => void d.dismiss(deliberationId)}>
                {t.monitor.delib_dismiss}
              </button>
            </div>
          )}
          {detail.spawnedAssignmentId && (
            <p className="typo-caption text-status-success mt-1">{t.monitor.delib_spawned}</p>
          )}
        </div>
      )}

      {/* Agenda — the termination model. A deliberation ends when the agenda is
          resolved, not when a turn budget runs out. */}
      {d.agenda.length > 0 && (
        <div>
          <p className="typo-label uppercase tracking-wider text-foreground opacity-45 mb-1">{t.monitor.delib_agenda}</p>
          <div className="space-y-1">
            {d.agenda.map((a) => (
              <div key={a.id} className="flex items-start gap-1.5">
                {a.status === 'resolved' ? (
                  <CheckCircle2 className="w-3 h-3 mt-0.5 flex-shrink-0 text-status-success" />
                ) : (
                  <CircleDot className="w-3 h-3 mt-0.5 flex-shrink-0 text-foreground opacity-40" />
                )}
                <span className={`typo-caption ${a.status === 'resolved' ? 'text-foreground opacity-50 line-through' : 'text-foreground'}`}>
                  {a.item}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
