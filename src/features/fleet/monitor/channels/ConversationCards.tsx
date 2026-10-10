import { memo, useMemo, useState } from 'react';
import { Check, ChevronDown, Pause, Play, Scale, Wand2, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Collapse } from '@/features/shared/components/display/Collapse';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import {
  PersonaStack, StepProgressStrip, stepMeta, useAssignmentSteps, usePersonaIndex,
} from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import { AUTHOR_KIND_META, authorName, itemAccent } from '@/features/teams/sub_collab/collabRender';
import { memberColor } from '@/lib/channel/eventModel';
import { usePipelineStore } from '@/stores/pipelineStore';
import { silentCatch } from '@/lib/silentCatch';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import type { TeamDeliberation } from '@/lib/bindings/TeamDeliberation';
import type { AssignProposal } from './conversationModel';
import { clusterStatus } from './conversationModel';

/* ----------------------------------------------------------------------------
 * CONVERSATION CARDS — the three non-chat things a channel can say.
 *
 * Shared by both variants ON PURPOSE: the design question is not what an
 * assignment card CONTAINS, it's WHERE it lives (in the stream as a band, or in
 * the rail behind an anchor). Keeping the content identical means the A/B is
 * about the layout thesis, not about which variant got the nicer card.
 * -------------------------------------------------------------------------- */

/* ── TALK ──────────────────────────────────────────────────────────────────── */

/** memo (C3): `item` keeps identity across quiet refreshes since C1, and
 *  `onOpen` is a state setter — so a poll that changes nothing re-parses no
 *  markdown and re-renders no bubble. */
export const TalkBubble = memo(function TalkBubble({ item, onOpen }: { item: TeamChannelItem; onOpen: (i: TeamChannelItem) => void }) {
  const personaIndex = usePersonaIndex();
  const persona = item.personaId ? personaIndex.get(item.personaId) : undefined;
  const accent = itemAccent(item, persona);
  const mine = item.kind === 'directive';

  // Machine rows (bus events) are a one-line strip, never a bubble — they're
  // ambient, not something anyone said.
  if (item.kind === 'event') {
    return (
      <div className="py-0.5 pl-2 flex items-center gap-2">
        <span className="w-1 h-1 rounded-full bg-foreground/25 flex-shrink-0" />
        <span className="typo-caption font-mono text-foreground opacity-45 flex-shrink-0">{item.label}</span>
        <span className="typo-caption text-foreground opacity-70 truncate">{item.body}</span>
      </div>
    );
  }

  return (
    <div className={`py-1 flex ${mine ? 'justify-end' : 'justify-start'}`}>
      {/* A div-with-role, not a <button>: the body renders markdown whose
          links must stay valid, clickable anchors (nested interactives are
          not). Bubble click still opens the detail modal. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(item)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          if ((e.target as HTMLElement).tagName === 'A') return;
          e.preventDefault();
          onOpen(item);
        }}
        className={`max-w-[78%] cursor-pointer text-left px-3 py-2 rounded-card border transition-colors focus-ring ${
          mine
            ? 'bg-primary/12 border-primary/20 hover:bg-primary/18'
            : 'bg-secondary/30 border-border hover:bg-secondary/45'
        }`}
      >
        {!mine && (
          <span className="flex items-center gap-1.5 mb-0.5">
            {/* Non-persona voices wear their own glyph — Slack included, so a
                bridged human is legible as an outside participant at a glance. */}
            {(item.kind === 'athena' || item.kind === 'director' || item.kind === 'slack') &&
              (() => {
                const M = AUTHOR_KIND_META[item.kind as 'athena' | 'director' | 'slack'];
                return <M.Icon className={`w-3 h-3 ${M.iconColor}`} />;
              })()}
            <span className="typo-caption" style={{ color: accent }}>
              {authorName(item, persona)}
            </span>
            <span className="typo-caption text-foreground opacity-35">
              <RelativeTime timestamp={item.at} />
            </span>
          </span>
        )}
        {/* Markdown, tightened for chat: paragraph/list rhythm compressed so
            a two-line remark doesn't inherit document spacing. The detail
            modal keeps the full document layout. */}
        <MarkdownRenderer
          content={item.body ?? ''}
          className="typo-body text-foreground break-words [&_p]:mb-1.5 [&_p:last-child]:mb-0 [&_ul]:mb-1.5 [&_ul:last-child]:mb-0 [&_ol]:mb-1.5 [&_ol:last-child]:mb-0 [&_pre]:mb-1.5 [&_table]:my-2 [&_h1]:mt-2 [&_h2]:mt-2 [&_h3]:mt-1.5"
        />
      </div>
    </div>
  );
});

/* ── ASSIGNMENT ────────────────────────────────────────────────────────────── */

/** memo (C3): `rowKey` + a keyed `onToggle` keep every prop referentially
 *  stable, so expanding one card re-renders that card, not every band. */
export const AssignmentCard = memo(function AssignmentCard({
  assignmentId, items, expanded, rowKey, onToggle,
}: {
  assignmentId: string;
  items: TeamChannelItem[];
  expanded: boolean;
  rowKey: string;
  onToggle: (key: string) => void;
}) {
  const { t, tx } = useTranslation();
  const personaIndex = usePersonaIndex();
  const label = clusterStatus(items);
  const live = label === 'step_running' || label === 'created';
  const { steps } = useAssignmentSteps(assignmentId, live);

  const pause = usePipelineStore((s) => s.pauseAssignment);
  const resume = usePipelineStore((s) => s.resumeAssignment);

  // Four passes over the step list, re-run on every render until this memo:
  // the card re-renders for reasons that have nothing to do with the steps
  // (a toggle elsewhere, a poll on the parent), and `personaIds` being a fresh
  // array also defeated `PersonaStack`'s own prop comparison every time.
  //
  // The rollup: the channel's event label ('step_running') is not a step
  // status ('running'), so stepMeta can't take it — it has to be derived.
  const { meta, personaIds, rework, done } = useMemo(() => {
    const rollup =
      steps.find((s) => s.status === 'failed')?.status ??
      steps.find((s) => s.status === 'awaiting_review')?.status ??
      steps.find((s) => s.status === 'running')?.status ??
      (steps.length > 0 && steps.every((s) => s.status === 'done' || s.status === 'skipped') ? 'done' : 'pending');
    return {
      meta: stepMeta(rollup),
      personaIds: steps.map((s) => s.assignedPersonaId),
      rework: steps.reduce((n, s) => n + (s.retryCount ?? 0), 0),
      done: steps.filter((s) => s.status === 'done').length,
    };
  }, [steps]);

  const title = items[0]?.body ?? t.monitor.conv_card_assignment;

  return (
    <div className="my-2 rounded-card border border-status-info/25 bg-status-info/[0.06] overflow-hidden">
      <button type="button" onClick={() => onToggle(rowKey)} className="w-full px-3 py-2 flex items-center gap-2.5 text-left hover:bg-status-info/[0.1] transition-colors">
        <Wand2 className="w-4 h-4 flex-shrink-0 text-status-info" />
        <span className="min-w-0 flex-1">
          <span className="block typo-body text-foreground truncate">{title}</span>
          <span className="flex items-center gap-2 mt-0.5">
            <span className={`typo-caption ${meta.tone}`}>{meta.label}</span>
            <span className="typo-caption text-foreground opacity-40 tabular-nums">
              {tx(t.monitor.conv_steps, { done, total: steps.length })}
            </span>
            {rework > 0 && (
              <span className="typo-caption text-status-warning">{tx(t.monitor.conv_rework, { count: rework })}</span>
            )}
            <span className="typo-caption text-foreground opacity-35">
              <RelativeTime timestamp={items[items.length - 1]!.at} />
            </span>
          </span>
        </span>
        <StepProgressStrip steps={steps} />
        <PersonaStack ids={personaIds} index={personaIndex} />
        <ChevronDown className={`w-4 h-4 flex-shrink-0 text-foreground opacity-40 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      <Collapse open={expanded} unmountWhenClosed duration={180} className="border-t border-status-info/20">
            <div className="px-3 py-2 space-y-1.5">
              {steps.map((s) => {
                const m = stepMeta(s.status);
                const persona = s.assignedPersonaId ? personaIndex.get(s.assignedPersonaId) : undefined;
                return (
                  <div key={s.id} className="flex items-start gap-2">
                    <m.icon className={`mt-0.5 w-3 h-3 flex-shrink-0 ${m.tone} ${m.spin ? 'animate-spin' : ''}`} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="typo-caption text-foreground truncate">{s.title}</span>
                        {persona && (
                          <span className="typo-caption flex-shrink-0" style={{ color: memberColor(persona, s.assignedPersonaId) }}>
                            {persona.name.replace(/^T:\s*/, '')}
                          </span>
                        )}
                        {(s.retryCount ?? 0) > 0 && (
                          <span className="typo-caption text-status-warning flex-shrink-0">×{(s.retryCount ?? 0) + 1}</span>
                        )}
                      </span>
                      {s.outputSummary && (
                        <MarkdownRenderer content={s.outputSummary} className="typo-caption opacity-70 mt-0.5" />
                      )}
                    </span>
                  </div>
                );
              })}

              <div className="flex items-center gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => void pause(assignmentId).catch(silentCatch('conv:pause'))}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-interactive border border-border typo-caption text-foreground hover:bg-secondary/40 transition-colors"
                >
                  <Pause className="w-3 h-3" /> {t.monitor.conv_pause}
                </button>
                <button
                  type="button"
                  onClick={() => void resume(assignmentId).catch(silentCatch('conv:resume'))}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-interactive border border-border typo-caption text-foreground hover:bg-secondary/40 transition-colors"
                >
                  <Play className="w-3 h-3" /> {t.monitor.conv_resume}
                </button>
              </div>
            </div>
      </Collapse>
    </div>
  );
});

/* ── DELIBERATION ──────────────────────────────────────────────────────────── */

const DELIB_STATUS: Record<string, string> = {
  open: 'text-status-info',
  converging: 'text-status-success',
  escalated: 'text-status-warning',
  paused: 'text-foreground',
  resolved: 'text-status-success',
  aborted: 'text-status-error',
  awaiting_action: 'text-status-warning',
};

/** memo (C3): same contract as AssignmentCard — keyed callbacks, stable props. */
export const DeliberationCard = memo(function DeliberationCard({
  deliberation, deliberationId, items, expanded, rowKey, onToggle, onFocus,
}: {
  deliberation: TeamDeliberation | undefined;
  deliberationId: string;
  items: TeamChannelItem[];
  expanded: boolean;
  rowKey: string;
  onToggle: (key: string) => void;
  /** Send this deliberation's CONTROLS to the rail. Expanding shows its turns;
   *  focusing is what lets you drive it — two different verbs on purpose. */
  onFocus: (deliberationId: string) => void;
}) {
  const { t } = useTranslation();
  const personaIndex = usePersonaIndex();
  const topic = deliberation?.topic ?? t.monitor.conv_card_deliberation;
  const status = deliberation?.status ?? 'open';
  const round = Number(deliberation?.round ?? 0);
  const spent = Number(deliberation?.costSpentUsd ?? 0);
  const budget = Number(deliberation?.costBudgetUsd ?? 5);
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;

  return (
    <div className="my-2 rounded-card border border-violet-400/25 bg-violet-400/[0.05] overflow-hidden">
      <button type="button" onClick={() => onToggle(rowKey)} className="w-full px-3 py-2 flex items-center gap-2.5 text-left hover:bg-violet-400/[0.09] transition-colors">
        <Scale className="w-4 h-4 flex-shrink-0 text-violet-300" />
        <span className="min-w-0 flex-1">
          <span className="block typo-body text-foreground truncate">{topic}</span>
          <span className="flex items-center gap-2 mt-0.5">
            <span className={`typo-caption ${DELIB_STATUS[status] ?? ''}`}>{status}</span>
            <span className="typo-caption text-foreground opacity-40 tabular-nums">round {round}</span>
            <span className="typo-caption text-foreground opacity-40">
              <Numeric value={spent} precision={2} /> / <Numeric value={budget} precision={2} />
            </span>
          </span>
        </span>
        {/* Cost meter — a deliberation is bounded by budget, not by turn count. */}
        <span className="w-20 h-1 rounded-full bg-foreground/10 overflow-hidden flex-shrink-0">
          <span
            className={`block h-full rounded-full ${pct > 80 ? 'bg-status-warning' : 'bg-violet-400'}`}
            style={{ width: `${pct}%` }}
          />
        </span>
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onFocus(deliberationId); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onFocus(deliberationId); } }}
          className="flex-shrink-0 px-2 py-0.5 rounded-interactive border border-violet-400/30 typo-caption text-violet-300 hover:bg-violet-400/15 transition-colors"
        >
          {t.monitor.conv_drive}
        </span>
        <ChevronDown className={`w-4 h-4 flex-shrink-0 text-foreground opacity-40 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      <Collapse open={expanded} unmountWhenClosed duration={180} className="border-t border-violet-400/20">
            <div className="px-3 py-2 space-y-1.5">
              {items.map((turn) => {
                const persona = turn.personaId ? personaIndex.get(turn.personaId) : undefined;
                return (
                  <div key={turn.id}>
                    <span className="typo-caption" style={{ color: memberColor(persona, turn.personaId) }}>
                      {persona?.name.replace(/^T:\s*/, '') ?? turn.label}
                    </span>
                    <p className="typo-caption text-foreground opacity-85 whitespace-pre-wrap">{turn.body}</p>
                  </div>
                );
              })}
            </div>
      </Collapse>
    </div>
  );
});

/* ── PROPOSAL — the composer's decomposed goal, awaiting Confirm ───────────── */

/** memo (C3): it was the one card in this file that was NOT memoized, and it
 *  took two inline lambdas minted per render by its one call site — so it
 *  re-rendered on every poll even though a proposal is local-only state that a
 *  poll cannot touch. The callbacks are KEYED now (they take the proposal /
 *  its goal) so the caller can hold them stable. */
export const ProposalCard = memo(function ProposalCard({
  proposal, onConfirm, onDismiss,
}: {
  proposal: AssignProposal;
  onConfirm: (proposal: AssignProposal) => void;
  onDismiss: (goal: string) => void;
}) {
  const { t, tx } = useTranslation();
  const personaIndex = usePersonaIndex();
  const [open, setOpen] = useState(true);

  return (
    <div className="my-2 rounded-card border border-status-info/35 bg-status-info/[0.08] overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-2">
        <Wand2 className="w-4 h-4 flex-shrink-0 text-status-info" />
        <span className="min-w-0 flex-1">
          <span className="block typo-body text-foreground truncate">{proposal.goal}</span>
          <span className="typo-caption text-foreground opacity-50">
            {proposal.status === 'launched'
              ? t.monitor.conv_proposal_running
              : tx(t.monitor.conv_proposal_steps, { count: proposal.steps.length })}
          </span>
        </span>
        <button type="button" onClick={() => setOpen((v) => !v)} className="p-1 rounded-interactive text-foreground opacity-50 hover:opacity-100">
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <div className="px-3 pb-2 space-y-1">
          {proposal.steps.map((s, i) => {
            const persona = s.suggestedPersonaId ? personaIndex.get(s.suggestedPersonaId) : undefined;
            return (
              <div key={i} className="flex items-center gap-2">
                <span className="typo-caption tabular-nums text-foreground opacity-35 w-4 flex-shrink-0">{i + 1}</span>
                <span className="typo-caption text-foreground truncate flex-1">{s.title}</span>
                {persona ? (
                  <span className="typo-caption flex-shrink-0" style={{ color: memberColor(persona, s.suggestedPersonaId) }}>
                    {persona.name.replace(/^T:\s*/, '')}
                  </span>
                ) : (
                  <span className="typo-caption text-status-warning flex-shrink-0">{t.monitor.conv_unrouted}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {proposal.status === 'pending' && (
        <div className="px-3 pb-2 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onConfirm(proposal)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-interactive border border-status-success/30 bg-status-success/10 typo-caption text-status-success hover:bg-status-success/20 transition-colors"
          >
            <Check className="w-3 h-3" /> {t.monitor.conv_proposal_run}
          </button>
          <button
            type="button"
            onClick={() => onDismiss(proposal.goal)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-interactive border border-border typo-caption text-foreground hover:bg-secondary/40 transition-colors"
          >
            <X className="w-3 h-3" /> {t.monitor.conv_proposal_drop}
          </button>
        </div>
      )}
    </div>
  );
});

/* ── GHOSTS — what a channel shows while its FIRST page is in flight ───────── */

/** Deterministic bubble widths + sides, so the ghost reads as a conversation
 *  rather than a barcode (overview-loading §C). */
const GHOST_BUBBLES: Array<{ w: string; mine: boolean; h: number }> = [
  { w: 'w-56', mine: false, h: 44 },
  { w: 'w-40', mine: true, h: 32 },
  { w: 'w-72', mine: false, h: 60 },
  { w: 'w-48', mine: true, h: 32 },
  { w: 'w-64', mine: false, h: 44 },
  { w: 'w-36', mine: true, h: 32 },
];

/**
 * @catalog ConversationGhostRows — calm, geometry-matched chat placeholders for a channel whose first page has not landed yet.
 *
 * Law 3 of `docs/design/overview-loading.md`: the delay lives on the
 * placeholder. Each bubble enters with `animate-fade-in` behind an
 * `animation-delay` starting at 120ms, so a warm channel paints none of this —
 * it is literally invisible until the fetch has been slow enough to deserve a
 * placeholder. No `animate-pulse`, no spinner, `aria-hidden`.
 */
export function ConversationGhostRows({ count = GHOST_BUBBLES.length }: { count?: number }) {
  return (
    <div aria-hidden data-testid="conversation-ghosts" className="flex-1 min-h-0 px-3 py-2 flex flex-col justify-end gap-2 overflow-hidden">
      {GHOST_BUBBLES.slice(0, count).map((g, i) => (
        <div key={i} className={`flex ${g.mine ? 'justify-end' : 'justify-start'}`}>
          <div
            className={`${g.w} rounded-card bg-primary/[0.06] animate-fade-in`}
            style={{ height: g.h, animationDelay: `${120 + i * 35}ms` }}
          />
        </div>
      ))}
    </div>
  );
}
