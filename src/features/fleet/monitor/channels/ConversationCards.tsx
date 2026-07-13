/* eslint-disable custom/no-hardcoded-jsx-text -- prototype variant; i18n at consolidation (plan P6). */
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Pause, Play, Scale, Wand2, X } from 'lucide-react';
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

export function TalkBubble({ item, onOpen }: { item: TeamChannelItem; onOpen: (i: TeamChannelItem) => void }) {
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
      <button
        type="button"
        onClick={() => onOpen(item)}
        className={`max-w-[78%] text-left px-3 py-2 rounded-card border transition-colors ${
          mine
            ? 'bg-primary/12 border-primary/20 hover:bg-primary/18'
            : 'bg-secondary/30 border-border hover:bg-secondary/45'
        }`}
      >
        {!mine && (
          <span className="flex items-center gap-1.5 mb-0.5">
            {(item.kind === 'athena' || item.kind === 'director') &&
              (() => {
                const M = AUTHOR_KIND_META[item.kind as 'athena' | 'director'];
                return <M.Icon className={`w-3 h-3 ${M.iconColor}`} />;
              })()}
            <span className="typo-caption font-medium" style={{ color: accent }}>
              {authorName(item, persona)}
            </span>
            <span className="typo-caption text-foreground opacity-35">
              <RelativeTime timestamp={item.at} />
            </span>
          </span>
        )}
        <span className="block typo-body text-foreground whitespace-pre-wrap break-words">{item.body}</span>
      </button>
    </div>
  );
}

/* ── ASSIGNMENT ────────────────────────────────────────────────────────────── */

export function AssignmentCard({
  assignmentId, items, expanded, onToggle, dense,
}: {
  assignmentId: string;
  items: TeamChannelItem[];
  expanded: boolean;
  onToggle: () => void;
  /** Dense = the anchor form (Dossier); full = the band form (Briefing). */
  dense?: boolean;
}) {
  const personaIndex = usePersonaIndex();
  const label = clusterStatus(items);
  const live = label === 'step_running' || label === 'created';
  const { steps } = useAssignmentSteps(assignmentId, live);

  // Roll the steps up into one status for the card. The channel's event label
  // ('step_running') is not a step status ('running'), so stepMeta can't take it.
  const rollup =
    steps.find((s) => s.status === 'failed')?.status ??
    steps.find((s) => s.status === 'awaiting_review')?.status ??
    steps.find((s) => s.status === 'running')?.status ??
    (steps.length > 0 && steps.every((s) => s.status === 'done' || s.status === 'skipped') ? 'done' : 'pending');
  const meta = stepMeta(rollup);
  const pause = usePipelineStore((s) => s.pauseAssignment);
  const resume = usePipelineStore((s) => s.resumeAssignment);

  const title = items[0]?.body ?? 'Assignment';
  const personaIds = steps.map((s) => s.assignedPersonaId);
  const rework = steps.reduce((n, s) => n + (s.retryCount ?? 0), 0);
  const done = steps.filter((s) => s.status === 'done').length;

  if (dense) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="w-full my-1 flex items-center gap-2 px-2.5 py-1.5 rounded-interactive border border-border bg-secondary/20 hover:bg-secondary/35 transition-colors text-left"
      >
        <Wand2 className="w-3.5 h-3.5 flex-shrink-0 text-status-info" />
        <span className="typo-caption text-foreground truncate flex-1">{title}</span>
        <StepProgressStrip steps={steps} />
        <span className={`typo-caption tabular-nums flex-shrink-0 ${meta.tone}`}>
          {done}/{steps.length || '·'}
        </span>
      </button>
    );
  }

  return (
    <div className="my-2 rounded-card border border-status-info/25 bg-status-info/[0.06] overflow-hidden">
      <button type="button" onClick={onToggle} className="w-full px-3 py-2 flex items-center gap-2.5 text-left hover:bg-status-info/[0.1] transition-colors">
        <Wand2 className="w-4 h-4 flex-shrink-0 text-status-info" />
        <span className="min-w-0 flex-1">
          <span className="block typo-body font-medium text-foreground truncate">{title}</span>
          <span className="flex items-center gap-2 mt-0.5">
            <span className={`typo-caption ${meta.tone}`}>{meta.label}</span>
            <span className="typo-caption text-foreground opacity-40 tabular-nums">
              {done}/{steps.length} steps
            </span>
            {rework > 0 && (
              <span className="typo-caption text-amber-300">{rework} rework</span>
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

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden border-t border-status-info/20"
          >
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
                          <span className="typo-caption text-amber-300 flex-shrink-0">×{(s.retryCount ?? 0) + 1}</span>
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
                  <Pause className="w-3 h-3" /> Pause
                </button>
                <button
                  type="button"
                  onClick={() => void resume(assignmentId).catch(silentCatch('conv:resume'))}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-interactive border border-border typo-caption text-foreground hover:bg-secondary/40 transition-colors"
                >
                  <Play className="w-3 h-3" /> Resume
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── DELIBERATION ──────────────────────────────────────────────────────────── */

const DELIB_STATUS: Record<string, string> = {
  open: 'text-status-info',
  converging: 'text-status-success',
  escalated: 'text-status-warning',
  paused: 'text-foreground',
  resolved: 'text-status-success',
  aborted: 'text-status-error',
  awaiting_action: 'text-amber-300',
};

export function DeliberationCard({
  deliberation, items, expanded, onToggle, dense,
}: {
  deliberation: TeamDeliberation | undefined;
  items: TeamChannelItem[];
  expanded: boolean;
  onToggle: () => void;
  dense?: boolean;
}) {
  const personaIndex = usePersonaIndex();
  const topic = deliberation?.topic ?? 'Deliberation';
  const status = deliberation?.status ?? 'open';
  const round = Number(deliberation?.round ?? 0);
  const spent = Number(deliberation?.costSpentUsd ?? 0);
  const budget = Number(deliberation?.costBudgetUsd ?? 5);
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;

  if (dense) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="w-full my-1 flex items-center gap-2 px-2.5 py-1.5 rounded-interactive border border-violet-400/25 bg-violet-400/[0.07] hover:bg-violet-400/[0.12] transition-colors text-left"
      >
        <Scale className="w-3.5 h-3.5 flex-shrink-0 text-violet-300" />
        <span className="typo-caption text-foreground truncate flex-1">{topic}</span>
        <span className={`typo-caption flex-shrink-0 ${DELIB_STATUS[status] ?? ''}`}>{status}</span>
        <span className="typo-caption text-foreground opacity-45 tabular-nums flex-shrink-0">r{round}</span>
      </button>
    );
  }

  return (
    <div className="my-2 rounded-card border border-violet-400/25 bg-violet-400/[0.05] overflow-hidden">
      <button type="button" onClick={onToggle} className="w-full px-3 py-2 flex items-center gap-2.5 text-left hover:bg-violet-400/[0.09] transition-colors">
        <Scale className="w-4 h-4 flex-shrink-0 text-violet-300" />
        <span className="min-w-0 flex-1">
          <span className="block typo-body font-medium text-foreground truncate">{topic}</span>
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
        <ChevronDown className={`w-4 h-4 flex-shrink-0 text-foreground opacity-40 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden border-t border-violet-400/20"
          >
            <div className="px-3 py-2 space-y-1.5">
              {items.map((turn) => {
                const persona = turn.personaId ? personaIndex.get(turn.personaId) : undefined;
                return (
                  <div key={turn.id}>
                    <span className="typo-caption font-medium" style={{ color: memberColor(persona, turn.personaId) }}>
                      {persona?.name.replace(/^T:\s*/, '') ?? turn.label}
                    </span>
                    <p className="typo-caption text-foreground opacity-85 whitespace-pre-wrap">{turn.body}</p>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── PROPOSAL — the composer's decomposed goal, awaiting Confirm ───────────── */

export function ProposalCard({
  proposal, onConfirm, onDismiss,
}: {
  proposal: AssignProposal;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const personaIndex = usePersonaIndex();
  const [open, setOpen] = useState(true);

  return (
    <div className="my-2 rounded-card border border-status-info/35 bg-status-info/[0.08] overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-2">
        <Wand2 className="w-4 h-4 flex-shrink-0 text-status-info" />
        <span className="min-w-0 flex-1">
          <span className="block typo-body font-medium text-foreground truncate">{proposal.goal}</span>
          <span className="typo-caption text-foreground opacity-50">
            {proposal.status === 'launched'
              ? 'Running — the team has it'
              : `${proposal.steps.length} steps routed · confirm to run`}
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
                  <span className="typo-caption text-status-warning flex-shrink-0">unrouted</span>
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
            onClick={onConfirm}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-interactive border border-status-success/30 bg-status-success/10 typo-caption text-status-success hover:bg-status-success/20 transition-colors"
          >
            <Check className="w-3 h-3" /> Run it
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-interactive border border-border typo-caption text-foreground hover:bg-secondary/40 transition-colors"
          >
            <X className="w-3 h-3" /> Drop
          </button>
        </div>
      )}
    </div>
  );
}
