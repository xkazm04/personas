import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Radio, ExternalLink, Send, Check, CheckCheck, Pin, AlertCircle, SkipForward, Ban, RotateCcw, ClipboardCheck, Activity, Sparkles } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { usePersonaIndex, PersonaChip, useAssignmentSteps } from '../sub_teamWorkspace/teamStudio/boardShared';
import { eventFamily, parsePayload } from '../sub_redRoom/useRedRoomFeed';
import { useTeamChannel, parseDeliveries } from './useTeamChannel';
import {
  STEP_VERB, STEP_TONE, FAMILY_TEXT, AUTHOR_KIND_META, authorName, itemAccent,
} from './collabRender';
import { useCompanionStore } from '@/features/plugins/companion/companionStore';
import { QuickAnswerReviewCard } from '@/features/shared/components/layout/quick-answer/QuickAnswerReviewCard';
import { resolveTeamAssignmentReview } from '@/api/pipeline/assignments';
import { listManualReviews, updateManualReviewStatus } from '@/api/overview/reviews';
import { silentCatch } from '@/lib/silentCatch';
import type { StudioMember } from '../sub_teamWorkspace/teamStudio/useTeamStudioData';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import type { ManualReviewItem } from '@/lib/types/types';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';

/**
 * CORRESPONDENCE — the flagship team channel (C5 winner).
 *
 * A bordered "channel" card: a HEADER BAND (crest · identity · live presence
 * with status dots · a data glance) over the conversation, with the composer as
 * a band at the bottom. Every message uses one uniform TWO-ROW shape —
 * SOURCE + EVENT on row 1, the MESSAGE in an accent-tinted container on row 2
 * (see `CorrespondenceRow` / `resolveRow`). "Needs your review" rows carry the
 * inline team-review intervention; pending manual reviews surface via the
 * shared QuickAnswerReviewCard. A designed empty state explains the channel.
 */
export function CollabLiveCorrespondence({ teamId, members }: { teamId: string; members: StudioMember[] }) {
  const personaIndex = usePersonaIndex();
  const { items, loaded, exhausted, posting, presence, loadOlder, sendDirective } = useTeamChannel(teamId);
  const [draft, setDraft] = useState('');
  const topSentinel = useRef<HTMLDivElement | null>(null);
  const scrollBox = useRef<HTMLDivElement | null>(null);
  const stickBottom = useRef(true);

  const memberIds = useMemo(() => new Set(members.map((m) => m.personaId)), [members]);
  const ordered = useMemo(() => [...items].reverse(), [items]);

  useEffect(() => {
    const box = scrollBox.current;
    if (box && stickBottom.current) box.scrollTop = box.scrollHeight;
  }, [ordered.length]);

  useEffect(() => {
    const el = topSentinel.current;
    if (!el || exhausted) return;
    const obs = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && loadOlder(),
      { rootMargin: '80px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [exhausted, loadOlder, ordered.length]);

  const onScroll = () => {
    const box = scrollBox.current;
    if (!box) return;
    stickBottom.current = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  };

  const send = () => {
    const text = draft.trim();
    if (!text || posting) return;
    setDraft('');
    void sendDirective(text);
    stickBottom.current = true;
    if (/@athena\b/i.test(text)) {
      useCompanionStore.getState().setPendingPrompt({
        text: `I posted this in a team channel and tagged you:\n\n"${text}"\n\nPlease respond or help with this.`,
        autoSend: true,
      });
      useCompanionStore.getState().setState('open');
    }
  };

  const workingNames = members
    .filter((m) => presence.get(m.personaId) === 'working')
    .map((m) => m.name.replace(/^T: /, ''));
  const reviewCount = members.filter((m) => presence.get(m.personaId) === 'waiting').length;

  return (
    <div className="h-full flex flex-col min-h-0 rounded-card border border-border bg-foreground/[0.01] overflow-hidden">
      {/* ── Header band: identity · live presence · data glance ── */}
      <div className="flex-shrink-0 border-b border-border bg-foreground/[0.015] px-4 py-3 flex items-center gap-3">
        <div className="relative w-8 h-8 rounded-full bg-status-error/15 flex items-center justify-center flex-shrink-0">
          <Radio className="w-4 h-4 text-status-error" />
        </div>
        <div className="min-w-0">
          <div className="typo-body-lg font-semibold text-foreground leading-tight">Team channel</div>
          <div className="typo-caption text-foreground/50 leading-tight truncate">
            {workingNames.length > 0 ? `${workingNames.slice(0, 3).join(', ')} working…` : `${members.length} members`}
          </div>
        </div>
        <div className="flex-1" />
        {/* Live presence */}
        <div className="flex items-center -space-x-1.5">
          {members.slice(0, 8).map((m) => {
            const st = presence.get(m.personaId);
            return (
              <span
                key={m.memberId}
                className="relative inline-flex items-center justify-center w-7 h-7 rounded-full bg-secondary/80 ring-2 ring-background"
                title={`${m.name.replace(/^T: /, '')}${st ? ` — ${st}` : ''}`}
                style={st === 'working' ? { boxShadow: `0 0 0 2px ${m.color ?? '#60a5fa'}` } : undefined}
              >
                <PersonaIcon icon={m.icon} color={m.color} size="w-4 h-4" />
                {st && (
                  <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ring-2 ring-background ${st === 'working' ? 'bg-status-info' : 'bg-status-warning'}`} />
                )}
              </span>
            );
          })}
        </div>
        {/* Data glance */}
        <div className="flex items-center gap-3.5 typo-data text-foreground tabular-nums pl-2 border-l border-border ml-1">
          <span className="flex items-center gap-1.5" title="Transmissions">
            <Activity className="w-4 h-4 text-foreground/45" /> {items.length}
          </span>
          {workingNames.length > 0 && <span className="text-status-info">{workingNames.length} working</span>}
          {reviewCount > 0 && (
            <span className="text-status-warning flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4" /> {reviewCount}
            </span>
          )}
        </div>
      </div>

      {/* ── Conversation ── */}
      <div ref={scrollBox} onScroll={onScroll} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-1">
        {/* Pending manual reviews (Director coaching / triage) for this team's
            personas — the quick-answer card, cross-referenced into the channel. */}
        <PendingReviewTray memberIds={memberIds} personaIndex={personaIndex} />
        {!exhausted && ordered.length > 0 && (
          <div ref={topSentinel} className="py-1 text-center">
            <span className="typo-caption text-foreground/40">loading earlier history…</span>
          </div>
        )}
        {exhausted && ordered.length > 0 && <p className="py-1 text-center typo-caption text-foreground/35">— start of the conversation —</p>}
        {!loaded && <p className="typo-body text-foreground/45 py-3">Tuning in…</p>}
        {loaded && ordered.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center py-14 px-6">
            <div className="relative flex items-center justify-center mb-4" style={{ width: 96, height: 96 }}>
              <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(circle at 50% 50%, rgba(248,113,113,0.14), transparent 70%)' }} />
              <div className="relative w-14 h-14 rounded-full bg-status-error/12 border border-status-error/20 flex items-center justify-center">
                <Radio className="w-7 h-7 text-status-error/80" />
              </div>
            </div>
            <h3 className="typo-section-title text-foreground">The team channel is quiet</h3>
            <p className="typo-body text-foreground/60 mt-1.5 max-w-sm">
              This is where the team talks — handoffs, PRs, QA verdicts, and Director coaching all land here as they happen.
            </p>
            <div className="mt-3 flex flex-col gap-1.5 typo-caption text-foreground/50">
              <span className="inline-flex items-center gap-1.5"><Send className="w-3.5 h-3.5 text-status-success" /> Post a directive below to steer the next steps</span>
              <span className="inline-flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-violet-300" /> Tag <span className="text-violet-300 font-medium">@athena</span> to bring her into the conversation</span>
            </div>
          </div>
        )}
        {ordered.map((item) => (
          <CorrespondenceRow key={item.id} item={item} personaIndex={personaIndex} />
        ))}
      </div>

      {/* ── Composer ── */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-3 border-t border-border bg-foreground/[0.015]">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          placeholder="Say something to the team… Tag @athena to bring her in"
          className="flex-1 px-3.5 py-2.5 rounded-input bg-secondary/30 border border-border typo-body text-foreground placeholder:text-foreground/35 focus:outline-none focus:border-primary/40"
        />
        <button
          type="button"
          onClick={send}
          disabled={posting}
          className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-interactive border border-status-success/30 bg-status-success/10 typo-body text-status-success hover:bg-status-success/20 transition-colors disabled:opacity-50"
        >
          <Send className="w-4 h-4" /> Send
        </button>
      </div>
    </div>
  );
}

/**
 * Resolve a channel item into the uniform two-row shape: SOURCE + EVENT for
 * row 1, MESSAGE for row 2. Keeps the per-kind vocabulary in one place so the
 * row layout below stays a single structure for every author kind.
 */
function resolveRow(item: TeamChannelItem) {
  let event = item.label;
  let eventTone = 'text-foreground/50';
  let eventMono = false;
  let message: string | null = item.body;
  let artifact: { url: string; label: string } | null = null;
  let isError = false;
  let alert = false;

  if (item.kind === 'step') {
    event = STEP_VERB[item.label] ?? item.label;
    eventTone = STEP_TONE[item.label] ?? 'text-foreground/55';
    isError = item.label === 'step_failed';
    alert = item.label === 'status_awaiting_review' || isError;
  } else if (item.kind === 'event') {
    const parsed = parsePayload(item.extra);
    message = parsed.summary;
    artifact = parsed.artifact;
    eventTone = FAMILY_TEXT[eventFamily(item.label)] ?? FAMILY_TEXT.other!;
    eventMono = true;
  } else if (item.kind === 'memory') {
    event = `memory · ${item.label}`;
    eventTone = 'text-amber-300/80';
  } else if (item.kind === 'directive') {
    event = 'directive';
    eventTone = 'text-status-success';
  } else if (item.kind === 'persona' || item.kind === 'athena' || item.kind === 'director') {
    const meta = AUTHOR_KIND_META[item.kind];
    event = meta.label;
    eventTone = meta.tag;
  }
  return { event, eventTone, eventMono, message, artifact, isError, alert };
}

/**
 * Uniform two-row message row.
 *   Row 1 (SOURCE + EVENT): sigil · author name (in their colour) · event chip · time
 *   Row 2 (MESSAGE): the body, in an accent-tinted container indented under the source
 * A "Needs your review" row carries the inline ReviewInterventionCard below.
 */
function CorrespondenceRow({ item, personaIndex }: { item: TeamChannelItem; personaIndex: ReturnType<typeof usePersonaIndex> }) {
  const persona = item.personaId ? personaIndex.get(item.personaId) : undefined;
  const accent = itemAccent(item, persona);
  const source = authorName(item, persona);
  const { event, eventTone, eventMono, message, artifact, isError, alert } = resolveRow(item);

  const isUser = item.kind === 'directive';
  const isAgentVoice = item.kind === 'athena' || item.kind === 'director';
  const intervene = item.kind === 'step' && item.label === 'status_awaiting_review' && !!item.assignmentId;

  const deliveries = isUser ? parseDeliveries(item) : [];
  const seenIds = [...new Set(deliveries.map((d) => d.persona_id))];

  // Row-2 container tint: tinted for human/agent voices, subtle for system rows.
  let bodyClass = 'border-primary/12 bg-secondary/15';
  if (isUser) bodyClass = 'border-status-success/25 bg-status-success/10';
  else if (item.kind === 'athena') bodyClass = AUTHOR_KIND_META.athena.bubble;
  else if (item.kind === 'director') bodyClass = AUTHOR_KIND_META.director.bubble;
  else if (item.kind === 'memory') bodyClass = 'border-amber-500/20 bg-amber-500/5';

  // Row-1 sigil.
  const sigil =
    item.kind === 'memory' ? (
      <Pin className="w-3.5 h-3.5 text-amber-300/80" />
    ) : isAgentVoice ? (
      (() => { const M = AUTHOR_KIND_META[item.kind as 'athena' | 'director']; return <M.Icon className={`w-3.5 h-3.5 ${M.iconColor}`} />; })()
    ) : persona ? (
      <PersonaIcon icon={persona.icon} color={persona.color} size="w-3.5 h-3.5" />
    ) : (
      <span className="typo-caption text-foreground/40">·</span>
    );

  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }} className="py-1">
      {/* Row 1 — SOURCE + EVENT */}
      <div className="flex items-center gap-2 flex-wrap leading-tight">
        <span
          className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-secondary/70 border flex-shrink-0"
          style={{ borderColor: accent }}
        >
          {sigil}
        </span>
        <span className="typo-body font-medium" style={{ color: accent }}>{source}</span>
        {alert && <AlertCircle className="w-3.5 h-3.5 text-status-warning flex-shrink-0" />}
        <span className={`typo-caption uppercase tracking-wider ${eventMono ? 'font-mono normal-case tracking-normal' : ''} ${eventTone}`}>{event}</span>
        <span className="ml-auto typo-caption text-foreground/30 flex-shrink-0"><RelativeTime timestamp={item.at} /></span>
      </div>

      {/* Row 2 — MESSAGE */}
      {(message || artifact || isUser || intervene) && (
        <div className="mt-1 ml-8">
          {(message || artifact || isUser) && (
            <div className={`rounded-card border px-3 py-2 ${bodyClass}`}>
              {message && (
                <p className={`typo-body whitespace-pre-wrap ${isError ? 'text-status-error/90' : 'text-foreground/85'}`}>{message}</p>
              )}
              {artifact && (
                <a href={artifact.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-interactive bg-secondary/40 border border-border typo-caption text-status-info hover:bg-secondary/60 transition-colors">
                  <ExternalLink className="w-3 h-3" /> {artifact.label}
                </a>
              )}
              {isUser && (
                <p className="mt-1 inline-flex items-center gap-1.5 typo-caption text-foreground/55 flex-wrap">
                  {seenIds.length > 0 ? (
                    <><CheckCheck className="w-3.5 h-3.5 text-status-success" /> seen by {seenIds.slice(0, 3).map((pid) => <PersonaChip key={pid} persona={personaIndex.get(pid)} />)}{seenIds.length > 3 && <span>+{seenIds.length - 3}</span>}</>
                  ) : (
                    <><Check className="w-3.5 h-3.5" /> delivered at next step boundary</>
                  )}
                </p>
              )}
            </div>
          )}
          {intervene && item.assignmentId && (
            <ReviewInterventionCard assignmentId={item.assignmentId} personaIndex={personaIndex} />
          )}
        </div>
      )}
    </motion.div>
  );
}

/**
 * Inline team-review intervention — the cross-reference for a "Needs your
 * review" channel row. Resolves the assignment's awaiting-review (or failed)
 * step in place via the team-review path (skip / abort / edit-and-retry),
 * mirroring the Flight Deck StepRelay actions so the user never leaves the
 * conversation. (Team step reviews use `resolveTeamAssignmentReview`, distinct
 * from the manual-review approve/reject path that `PendingReviewTray` wires.)
 */
function ReviewInterventionCard({
  assignmentId,
  personaIndex,
}: {
  assignmentId: string;
  personaIndex: ReturnType<typeof usePersonaIndex>;
}) {
  const { steps, refresh } = useAssignmentSteps(assignmentId, true);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const step = steps.find((s) => s.status === 'awaiting_review') ?? steps.find((s) => s.status === 'failed');
  if (!step) return null;
  const persona = step.assignedPersonaId ? personaIndex.get(step.assignedPersonaId) : undefined;

  const act = async (kind: 'skip' | 'abort' | 'edit') => {
    setBusy(kind);
    try {
      if (kind === 'edit') {
        await resolveTeamAssignmentReview(step.id, { action: 'edit_requirement', data: { description: note.trim() } });
      } else {
        await resolveTeamAssignmentReview(step.id, { action: kind });
      }
      setNote('');
      refresh();
    } catch (err) {
      silentCatch('collab/correspondence:reviewIntervention')(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-1 rounded-card border border-status-warning/30 bg-status-warning/5 p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <ClipboardCheck className="w-4 h-4 text-status-warning flex-shrink-0" />
        <span className="typo-body font-semibold text-foreground truncate min-w-0">{step.title}</span>
        <PersonaChip persona={persona} />
      </div>
      {step.errorMessage && (
        <p className="typo-caption text-status-error/90 leading-snug">{step.errorMessage}</p>
      )}
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional: revise the requirement, then Edit & retry…"
        className="px-3 py-1.5 rounded-input bg-primary/5 border border-card-border typo-caption text-foreground placeholder:text-foreground/40 focus:outline-none focus:border-primary/40"
      />
      <div className="flex items-center gap-1.5 self-end flex-wrap">
        <button
          type="button"
          disabled={!!busy}
          onClick={() => void act('skip')}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive border border-card-border bg-secondary/40 typo-caption text-foreground/85 hover:bg-secondary/60 transition-colors disabled:opacity-50"
        >
          <SkipForward className="w-3 h-3" /> Skip
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => void act('abort')}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive border border-status-error/25 bg-status-error/10 typo-caption text-status-error hover:bg-status-error/20 transition-colors disabled:opacity-50"
        >
          <Ban className="w-3 h-3" /> Abort
        </button>
        <button
          type="button"
          disabled={!!busy || !note.trim()}
          onClick={() => void act('edit')}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive border border-primary/30 bg-primary/10 typo-caption text-primary hover:bg-primary/20 transition-colors disabled:opacity-40"
        >
          <RotateCcw className="w-3 h-3" /> Edit &amp; retry
        </button>
      </div>
    </div>
  );
}

/**
 * Lightweight team-scoped pending-review feed. Deliberately does NOT reuse
 * `usePendingInteractions`/`useMonitorData` (which also poll persona summaries
 * + messages on the dashboard cadence) — an always-on channel surface
 * shouldn't carry that load. Polls only `list_manual_reviews(pending)` on a
 * gentle interval, filters to team members, and joins persona display info
 * from the channel's persona index. Resolves via `update_manual_review_status`.
 */
function useTeamPendingReviews(memberIds: Set<string>, personaIndex: ReturnType<typeof usePersonaIndex>) {
  const [reviews, setReviews] = useState<ManualReviewItem[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useMemo(
    () => () => {
      listManualReviews(undefined, 'pending')
        .then((rows) => {
          const mapped = rows
            .filter((r) => memberIds.has(r.persona_id))
            .map((r): ManualReviewItem => {
              const p = personaIndex.get(r.persona_id);
              return {
                id: r.id,
                persona_id: r.persona_id,
                execution_id: r.execution_id,
                review_type: '',
                content: r.description ?? '',
                severity: r.severity,
                status: r.status,
                reviewer_notes: r.reviewer_notes,
                context_data: r.context_data,
                suggested_actions: r.suggested_actions,
                title: r.title,
                created_at: r.created_at,
                resolved_at: r.resolved_at,
                persona_name: p?.name?.replace(/^T: /, '') ?? undefined,
                persona_icon: p?.icon ?? undefined,
                persona_color: p?.color ?? undefined,
              };
            });
          setReviews(mapped);
        })
        .catch(silentCatch('collab/correspondence:pendingReviews'));
    },
    [memberIds, personaIndex],
  );

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  const onAction = async (id: string, status: ManualReviewStatus, notes?: string) => {
    setBusy(true);
    try {
      await updateManualReviewStatus(id, status, notes);
      setReviews((prev) => prev.filter((r) => r.id !== id)); // optimistic
    } catch (err) {
      silentCatch('collab/correspondence:resolveReview')(err);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  return { reviews, busy, onAction };
}

/**
 * Pending manual reviews (Director coaching / auto-triage) for this team's
 * personas, surfaced as the shared QuickAnswerReviewCard — the same approve/
 * reject component the title-bar quick-answer popover uses. This is the
 * cross-reference into the channel: a review raised against any team member
 * becomes actionable here, where the team is talking.
 */
function PendingReviewTray({ memberIds, personaIndex }: { memberIds: Set<string>; personaIndex: ReturnType<typeof usePersonaIndex> }) {
  const { reviews: teamReviews, busy, onAction } = useTeamPendingReviews(memberIds, personaIndex);
  if (teamReviews.length === 0) return null;
  return (
    <div className="mb-2 pb-2 border-b border-border space-y-1.5">
      <div className="flex items-center gap-2 px-1">
        <ClipboardCheck className="w-3.5 h-3.5 text-status-warning" />
        <span className="typo-label uppercase tracking-[0.18em] text-status-warning/80 font-semibold">Needs your input</span>
        <span className="ml-auto typo-caption text-foreground/40 tabular-nums">{teamReviews.length}</span>
      </div>
      <AnimatePresence initial={false}>
        {teamReviews.map((r) => (
          <motion.div key={r.id} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
            <QuickAnswerReviewCard review={r} busy={busy} onAction={onAction} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export default CollabLiveCorrespondence;
