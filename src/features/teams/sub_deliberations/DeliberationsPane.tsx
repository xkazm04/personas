// Design D — the deliberation surface (D6). Left: a team's deliberations + a
// start form. Right: the selected deliberation — header (status + round + cost
// meter), the live agenda, the persona turn stream, and the gated proposal /
// escalation card. The deliberation is bounded by progress (agenda + stall),
// not a turn count, so there is NO turn meter — the agenda is the progress.
import { useMemo, useState } from 'react';
import {
  MessagesSquare,
  Plus,
  Gavel,
  CheckCircle2,
  CircleDot,
  AlertTriangle,
  Play,
  Square,
  Wrench,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { usePersonaIndex } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { TeamChannelMessage } from '@/lib/bindings/TeamChannelMessage';
import type { ProposalSpec } from '@/lib/bindings/ProposalSpec';
import type { PendingAction } from '@/lib/bindings/PendingAction';
import { useTeamDeliberations } from './useTeamDeliberations';

const DEFAULT_BUDGET = 5;

const STATUS_TONE: Record<string, string> = {
  open: 'bg-primary/15 text-primary border-primary/30',
  converging: 'bg-primary/15 text-primary border-primary/30',
  resolved: 'bg-status-success/15 text-status-success border-status-success/30',
  escalated: 'bg-status-warning/15 text-status-warning border-status-warning/30',
  awaiting_action: 'bg-status-warning/15 text-status-warning border-status-warning/30',
  paused: 'bg-secondary/60 text-foreground border-primary/20',
  aborted: 'bg-secondary/60 text-foreground border-primary/20',
};

interface Resolution {
  status?: string;
  proposal?: ProposalSpec | null;
  assignmentId?: string;
}
function parseResolution(raw: string | null): Resolution | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    return {
      status: typeof v.status === 'string' ? v.status : undefined,
      proposal: (v.proposal as ProposalSpec | null) ?? null,
      assignmentId: typeof v.assignment_id === 'string' ? v.assignment_id : undefined,
    };
  } catch {
    return null;
  }
}

export function DeliberationsPane({ teamId }: { teamId: string }) {
  const { t } = useTranslation();
  const td = t.deliberation;
  const personaIndex = usePersonaIndex();
  const {
    list,
    selectedId,
    setSelectedId,
    detail,
    agenda,
    turns,
    loading,
    busy,
    advancing,
    actionBusy,
    running,
    create,
    advance,
    runToBudget,
    stopRun,
    approveAction,
    skipAction,
    approve,
    dismiss,
  } = useTeamDeliberations(teamId);

  const [topic, setTopic] = useState('');
  const [goal, setGoal] = useState('');
  const [budget, setBudget] = useState('');

  const statusLabel = (s: string): string =>
    (td as Record<string, string>)[`status_${s}`] ?? s;

  const authorLabel = (m: TeamChannelMessage): string => {
    switch (m.authorKind) {
      case 'persona':
        return (m.authorId && personaIndex.get(m.authorId)?.name) || td.author_teammate;
      case 'user':
        return td.author_you;
      case 'system':
        return td.author_moderator;
      case 'athena':
        return 'Athena';
      case 'director':
        return 'Director';
      default:
        return m.authorKind;
    }
  };

  const onStart = async () => {
    const tt = topic.trim();
    if (!tt) return;
    const b = Number(budget);
    await create(tt, goal.trim() || undefined, b > 0 ? b : undefined);
    setTopic('');
    setGoal('');
    setBudget('');
  };

  const openAgenda = agenda.filter((a) => a.status === 'open');
  const resolvedAgenda = agenda.filter((a) => a.status !== 'open');
  const resolution = useMemo(() => parseResolution(detail?.resolution ?? null), [detail?.resolution]);
  const pendingAction = useMemo<PendingAction | null>(() => {
    if (!detail?.pendingAction) return null;
    try {
      return JSON.parse(detail.pendingAction) as PendingAction;
    } catch {
      return null;
    }
  }, [detail?.pendingAction]);
  const canAutoAdvance = detail ? ['open', 'converging'].includes(detail.status) : false;

  return (
    <div className="flex h-full gap-4">
      {/* ── Left: start form + list ───────────────────────────────────────── */}
      <div className="flex w-72 flex-shrink-0 flex-col gap-3">
        <div className="rounded-card border border-primary/10 bg-secondary/15 p-3">
          <p className="typo-label uppercase tracking-wider text-foreground mb-2">{td.new}</p>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder={td.topic_placeholder}
            className="w-full rounded-input border border-primary/15 bg-background/60 px-2 py-1.5 typo-body text-foreground placeholder:text-foreground/40 mb-2"
          />
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder={td.goal_placeholder}
            className="w-full rounded-input border border-primary/15 bg-background/60 px-2 py-1.5 typo-caption text-foreground placeholder:text-foreground/40 mb-2"
          />
          <input
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            type="number"
            min="0"
            step="0.5"
            inputMode="decimal"
            placeholder={td.budget_placeholder}
            className="w-full rounded-input border border-primary/15 bg-background/60 px-2 py-1.5 typo-caption text-foreground placeholder:text-foreground/40 mb-2"
          />
          <AsyncButton
            onClick={onStart}
            disabled={!topic.trim() || busy}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-interactive border border-primary/30 bg-primary/15 px-2 py-1.5 typo-body font-medium text-primary hover:bg-primary/25 transition-colors disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" /> {td.start}
          </AsyncButton>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5">
          {loading ? (
            <div className="flex justify-center pt-6">
              <LoadingSpinner />
            </div>
          ) : list.length === 0 ? (
            <p className="px-1 pt-2 typo-caption text-foreground/60">{td.list_empty}</p>
          ) : (
            list.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setSelectedId(d.id)}
                className={`w-full rounded-interactive border px-2.5 py-2 text-left transition-colors ${
                  d.id === selectedId
                    ? 'border-primary/45 bg-secondary/40'
                    : 'border-primary/10 bg-secondary/20 hover:bg-secondary/40'
                }`}
              >
                <span className="typo-body font-medium text-foreground line-clamp-2">{d.topic}</span>
                <span className="mt-1 flex items-center gap-1.5">
                  <span
                    className={`rounded-full border px-1.5 py-px typo-caption ${
                      STATUS_TONE[d.status] ?? STATUS_TONE.paused
                    }`}
                  >
                    {statusLabel(d.status)}
                  </span>
                  <RelativeTime timestamp={d.updatedAt} className="typo-caption text-foreground/60" />
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Right: detail ─────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {!detail ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <MessagesSquare className="h-8 w-8 text-foreground/40" />
            <p className="typo-body font-medium text-foreground">{td.empty_title}</p>
            <p className="typo-caption text-foreground/60 max-w-sm">{td.empty_hint}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Header */}
            <div className="rounded-card border border-primary/10 bg-secondary/15 p-4">
              <div className="flex items-start gap-2">
                <h2 className="typo-heading font-semibold text-foreground flex-1">{detail.topic}</h2>
                <span
                  className={`rounded-full border px-2 py-0.5 typo-caption font-medium ${
                    STATUS_TONE[detail.status] ?? STATUS_TONE.paused
                  }`}
                >
                  {statusLabel(detail.status)}
                </span>
              </div>
              {detail.goal && <p className="mt-1 typo-caption text-foreground/70">{detail.goal}</p>}
              <div className="mt-3 flex items-center gap-4 typo-caption text-foreground/70">
                <span>
                  {td.round} <span className="tabular-nums text-foreground">{detail.round}</span>
                </span>
                <span className="flex-1">
                  <span className="flex items-center justify-between">
                    <span>{td.cost_spent}</span>
                    <span className="tabular-nums text-foreground">
                      <Numeric value={detail.costSpentUsd} unit="usd" /> /{' '}
                      <Numeric value={detail.costBudgetUsd ?? DEFAULT_BUDGET} unit="usd" />
                    </span>
                  </span>
                  <span className="mt-1 block h-1 overflow-hidden rounded-full bg-secondary/50">
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{
                        width: `${Math.min(
                          100,
                          (detail.costSpentUsd / (detail.costBudgetUsd ?? DEFAULT_BUDGET)) * 100,
                        )}%`,
                      }}
                    />
                  </span>
                </span>
              </div>
              {['open', 'converging', 'escalated', 'paused'].includes(detail.status) && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <AsyncButton
                    onClick={async () => {
                      try {
                        await advance(detail.id);
                      } catch (e) {
                        toastCatch('DeliberationsPane.advance')(e);
                      }
                    }}
                    isLoading={advancing}
                    disabled={running}
                    className="inline-flex items-center gap-1.5 rounded-interactive border border-primary/30 bg-primary/15 px-3 py-1.5 typo-body font-medium text-primary hover:bg-primary/25 transition-colors disabled:opacity-50"
                  >
                    <Play className="h-3.5 w-3.5" /> {advancing ? td.advance_running : td.advance}
                  </AsyncButton>
                  {canAutoAdvance &&
                    (running ? (
                      <button
                        type="button"
                        onClick={stopRun}
                        className="inline-flex items-center gap-1.5 rounded-interactive border border-status-warning/30 bg-status-warning/15 px-3 py-1.5 typo-body font-medium text-status-warning hover:bg-status-warning/25 transition-colors"
                      >
                        <Square className="h-3.5 w-3.5" /> {td.run_stop}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          void runToBudget(detail.id);
                        }}
                        disabled={advancing}
                        className="inline-flex items-center gap-1.5 rounded-interactive border border-primary/20 px-3 py-1.5 typo-body text-foreground/80 hover:bg-secondary/40 transition-colors disabled:opacity-50"
                      >
                        <Play className="h-3.5 w-3.5" /> {td.run_to_budget}
                      </button>
                    ))}
                  {running && (
                    <span className="inline-flex items-center gap-1.5 typo-caption text-foreground/60">
                      <LoadingSpinner /> {td.run_active}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Gated capability action — Approve & run / Skip */}
            {detail.status === 'awaiting_action' && pendingAction && (
              <div className="rounded-card border border-status-warning/35 bg-status-warning/[0.08] p-4">
                <p className="flex items-center gap-1.5 typo-body font-semibold text-status-warning">
                  <Wrench className="h-4 w-4" /> {td.action_title}
                </p>
                <p className="mt-2 typo-body text-foreground">
                  <span className="font-medium">{pendingAction.personaName}</span> →{' '}
                  {pendingAction.useCaseTitle}
                </p>
                {pendingAction.rationale && (
                  <p className="mt-1 typo-caption text-foreground/70 italic">
                    {pendingAction.rationale}
                  </p>
                )}
                <div className="mt-3 flex gap-2">
                  <AsyncButton
                    onClick={async () => {
                      try {
                        await approveAction(detail.id);
                      } catch (e) {
                        toastCatch('DeliberationsPane.approveAction')(e);
                      }
                    }}
                    isLoading={actionBusy}
                    className="inline-flex items-center gap-1.5 rounded-interactive border border-status-success/30 bg-status-success/15 px-3 py-1.5 typo-body font-medium text-status-success hover:bg-status-success/25 transition-colors disabled:opacity-50"
                  >
                    <Wrench className="h-3.5 w-3.5" /> {td.action_run}
                  </AsyncButton>
                  <AsyncButton
                    onClick={async () => {
                      try {
                        await skipAction(detail.id);
                      } catch (e) {
                        toastCatch('DeliberationsPane.skipAction')(e);
                      }
                    }}
                    disabled={actionBusy}
                    className="inline-flex items-center gap-1.5 rounded-interactive border border-primary/20 px-3 py-1.5 typo-body text-foreground/80 hover:bg-secondary/40 transition-colors disabled:opacity-50"
                  >
                    {td.action_skip}
                  </AsyncButton>
                </div>
              </div>
            )}

            {/* Proposal / escalation card */}
            {detail.status === 'escalated' && (
              <div className="rounded-card border border-status-warning/30 bg-status-warning/[0.08] p-4">
                <p className="flex items-center gap-1.5 typo-body font-semibold text-status-warning">
                  <AlertTriangle className="h-4 w-4" /> {td.escalated_title}
                </p>
                <p className="mt-1 typo-caption text-foreground/80">{td.escalated_body}</p>
              </div>
            )}
            {resolution?.proposal && resolution.status === 'pending' && (
              <div className="rounded-card border border-primary/25 bg-primary/[0.06] p-4">
                <p className="flex items-center gap-1.5 typo-body font-semibold text-foreground">
                  <Gavel className="h-4 w-4 text-primary" /> {td.proposal}: {resolution.proposal.title}
                </p>
                <p className="mt-2 typo-caption text-foreground/80">{resolution.proposal.objective}</p>
                <p className="mt-2 typo-caption text-foreground/60 italic">{resolution.proposal.summary}</p>
                <div className="mt-3 flex gap-2">
                  <AsyncButton
                    onClick={async () => {
                      try {
                        await approve(detail.id);
                      } catch (e) {
                        toastCatch('DeliberationsPane.approve')(e);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-interactive border border-status-success/30 bg-status-success/15 px-3 py-1.5 typo-body font-medium text-status-success hover:bg-status-success/25 transition-colors"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> {td.approve}
                  </AsyncButton>
                  <AsyncButton
                    onClick={async () => {
                      try {
                        await dismiss(detail.id);
                      } catch (e) {
                        toastCatch('DeliberationsPane.dismiss')(e);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-interactive border border-primary/20 px-3 py-1.5 typo-body text-foreground/80 hover:bg-secondary/40 transition-colors"
                  >
                    {td.dismiss}
                  </AsyncButton>
                </div>
              </div>
            )}
            {resolution?.status === 'approved' && resolution.assignmentId && (
              <div className="rounded-card border border-status-success/25 bg-status-success/[0.06] p-3 typo-caption text-foreground/80">
                {td.spawned_assignment} <code className="text-foreground">{resolution.assignmentId}</code>
              </div>
            )}
            {resolution?.status === 'dismissed' && (
              <div className="rounded-card border border-primary/10 bg-secondary/20 p-3 typo-caption text-foreground/60">
                {td.proposal_dismissed}
              </div>
            )}

            {/* Agenda */}
            <div className="rounded-card border border-primary/10 bg-secondary/15 p-4">
              <p className="typo-label uppercase tracking-wider text-primary mb-2">{td.agenda}</p>
              {agenda.length === 0 ? (
                <p className="typo-caption text-foreground/60">{td.agenda_empty}</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {openAgenda.map((a) => (
                    <li key={a.id} className="flex items-start gap-1.5 typo-caption text-foreground">
                      <CircleDot className="mt-0.5 h-3 w-3 flex-shrink-0 text-primary/70" />
                      <span>{a.item}</span>
                    </li>
                  ))}
                  {resolvedAgenda.map((a) => (
                    <li key={a.id} className="flex items-start gap-1.5 typo-caption text-foreground/60">
                      <CheckCircle2 className="mt-0.5 h-3 w-3 flex-shrink-0 text-status-success/70" />
                      <span>
                        <span className="line-through">{a.item}</span>
                        {a.resolution && <span className="text-foreground/50"> — {a.resolution}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Turn stream */}
            <div className="rounded-card border border-primary/10 bg-secondary/15 p-4">
              <p className="typo-label uppercase tracking-wider text-primary mb-2">{td.conversation}</p>
              {turns.length === 0 ? (
                <p className="typo-caption text-foreground/60">{td.turns_empty}</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {turns.map((m) => (
                    <div key={m.id}>
                      <p className="flex items-center gap-1.5 typo-caption font-semibold text-foreground">
                        {authorLabel(m)}
                        <RelativeTime timestamp={m.createdAt} className="typo-caption font-normal text-foreground/50" />
                      </p>
                      <p className="mt-0.5 typo-body text-foreground/85 whitespace-pre-wrap">{m.body}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default DeliberationsPane;
