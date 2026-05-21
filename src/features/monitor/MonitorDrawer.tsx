// MonitorDrawer — the top-down triage drawer for one persona.
//
// Slides DOWN from the top over the Monitor grid (the grid stays mounted).
// Two stacked sections: Reviews (inline human-review triage) and Activity
// (live process rows with reasoning-trace expansion + navigation).

import { useState, useCallback, useMemo } from 'react';
import { X, Check, MessageSquare, Clock } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import ReasoningTrace from '@/features/shared/components/layout/ReasoningTrace';
import { useReasoningTrace } from '@/hooks/execution/useReasoningTrace';
import { useTranslation } from '@/i18n/useTranslation';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { stripPersonaPrefix } from '@/features/overview/sub_manual-review/libs/reviewHelpers';
import { ContextDataPreview } from '@/features/overview/sub_manual-review/components/ReviewListItem';
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import type { ManualReviewItem, SidebarSection, DevToolsTab, PluginTab } from '@/lib/types/types';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';
import type { ActiveProcess } from '@/stores/slices/processActivitySlice';
import {
  ATTENTION_META, reviewBucket, processStatusMeta, processStatusLabel, attentionLabel, elapsedStr,
  type PersonaCardModel, type SeverityBucket, type ProcessEntry,
} from './monitorModel';

interface MonitorDrawerProps {
  card: PersonaCardModel;
  isProcessing: boolean;
  now: number;
  onAction: (id: string, status: ManualReviewStatus, notes?: string) => void;
  onClose: () => void;
}

/** Navigate to the surface a process points at, then dismiss the Monitor. */
function navigateToProcess(proc: ActiveProcess, dismiss: () => void) {
  if (!proc.navigateTo) return;
  const { section, tab, personaId, chatSessionId } = proc.navigateTo;
  const system = useSystemStore.getState();
  system.setSidebarSection(section as SidebarSection);
  if (tab) {
    if (section === 'personas') {
      system.setEditorTab(tab as Parameters<typeof system.setEditorTab>[0]);
    } else if (section === 'plugins') {
      system.setPluginTab('dev-tools' as PluginTab);
      system.setDevToolsTab(tab as DevToolsTab);
    } else {
      system.setTemplateTab(tab as 'n8n' | 'generated');
    }
  }
  if (personaId) {
    useAgentStore.getState().selectPersona(personaId);
    if (chatSessionId && tab === 'chat') {
      void useAgentStore.getState().restoreChatSession(personaId, chatSessionId);
    }
  }
  dismiss();
}

export function MonitorDrawer({ card, isProcessing, now, onAction, onClose }: MonitorDrawerProps) {
  const { t, tx } = useTranslation();
  const sortedReviews = useMemo(
    () => [...card.reviews].sort(
      (a, b) => ATTENTION_META[reviewBucket(a.severity)].rank - ATTENTION_META[reviewBucket(b.severity)].rank,
    ),
    [card.reviews],
  );
  // Action states first (input_required, draft_ready), then running, then queued.
  const sortedProcesses = useMemo(() => {
    const order: Record<string, number> = { input_required: 0, draft_ready: 1, running: 2, queued: 3 };
    return [...card.processes].sort(
      (a, b) => (order[a.proc.status] ?? 9) - (order[b.proc.status] ?? 9),
    );
  }, [card.processes]);

  const empty = sortedReviews.length === 0 && sortedProcesses.length === 0;

  return (
    <>
      {/* Drawer header */}
      <div className="flex-shrink-0 flex items-center justify-between gap-3 px-5 h-14 border-b border-primary/10 bg-secondary/20">
        <div className="flex items-center gap-2.5 min-w-0">
          <PersonaIcon icon={card.personaIcon} color={card.personaColor} display="pop" frameSize="md" />
          <div className="min-w-0">
            <h3 className="typo-heading font-semibold text-foreground leading-tight truncate">{card.personaName}</h3>
            <p className="typo-caption text-foreground leading-tight">
              {tx(t.monitor.drawer_summary, { reviews: card.reviews.length, processes: card.processes.length })}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-modal border border-primary/15 text-foreground hover:text-foreground hover:bg-secondary/30 transition-colors"
          title={t.monitor.close_hint}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Drawer body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
        {empty ? (
          <div className="h-full min-h-[180px] flex flex-col items-center justify-center gap-3 text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-500/12 border border-emerald-500/25 flex items-center justify-center">
              <Check className="w-6 h-6 text-emerald-400" />
            </div>
            <p className="typo-body font-medium text-foreground">{t.monitor.drawer_empty}</p>
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-modal border border-primary/15 bg-secondary/20 typo-heading font-medium text-foreground hover:bg-secondary/40 transition-colors"
            >
              {t.monitor.back_to_grid}
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            {sortedReviews.length > 0 && (
              <section className="space-y-3">
                <h4 className="typo-caption uppercase tracking-wider text-foreground">
                  {tx(t.monitor.section_reviews, { count: sortedReviews.length })}
                </h4>
                {sortedReviews.map((review) => (
                  <DrawerReviewCard
                    key={review.id}
                    review={review}
                    personaName={card.personaName}
                    isProcessing={isProcessing}
                    onAction={onAction}
                  />
                ))}
              </section>
            )}
            {sortedProcesses.length > 0 && (
              <section className="space-y-2">
                <h4 className="typo-caption uppercase tracking-wider text-foreground">
                  {tx(t.monitor.section_activity, { count: sortedProcesses.length })}
                </h4>
                <div className="rounded-card border border-primary/10 bg-secondary/15 overflow-hidden">
                  {sortedProcesses.map((entry) => (
                    <MonitorActivityRow key={entry.key} entry={entry} now={now} onNavigate={onClose} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Review card — inline triage
// ---------------------------------------------------------------------------

interface DrawerReviewCardProps {
  review: ManualReviewItem;
  personaName: string;
  isProcessing: boolean;
  onAction: (id: string, status: ManualReviewStatus, notes?: string) => void;
}

function DrawerReviewCard({ review, personaName, isProcessing, onAction }: DrawerReviewCardProps) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const sev: SeverityBucket = reviewBucket(review.severity);
  const M = ATTENTION_META[sev];
  const Icon = M.icon;

  const act = useCallback(
    (status: ManualReviewStatus) => {
      if (isProcessing) return;
      onAction(review.id, status, notes || undefined);
    },
    [isProcessing, notes, onAction, review.id],
  );

  return (
    <div className="rounded-card border border-primary/10 bg-secondary/20 overflow-hidden">
      <div className="flex items-start gap-3 px-4 py-3">
        <div className={`w-8 h-8 rounded-modal border flex items-center justify-center flex-shrink-0 ${M.chip}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className={`typo-caption font-medium uppercase ${M.text}`}>{attentionLabel(t, sev)}</span>
            {review.source === 'cloud' && (
              <>
                <span className="typo-caption text-foreground">·</span>
                <span className="typo-caption text-cyan-400">{t.monitor.cloud}</span>
              </>
            )}
            <span className="typo-caption text-foreground">·</span>
            <Clock className="w-3 h-3 text-foreground" />
            <span className="typo-caption text-foreground">{formatRelativeTime(review.created_at)}</span>
          </div>
          <h5 className="typo-body font-semibold text-foreground leading-snug">
            {stripPersonaPrefix(review.title, personaName) || t.monitor.untitled}
          </h5>
          {review.content && (
            <p className="typo-body text-foreground/85 whitespace-pre-wrap leading-relaxed mt-1">{review.content}</p>
          )}
          {review.context_data && (
            <div className="rounded-card border border-primary/10 bg-secondary/30 px-3 py-2 mt-2">
              <div className="typo-caption font-mono uppercase text-foreground mb-1.5">{t.monitor.context}</div>
              <ContextDataPreview raw={review.context_data} />
            </div>
          )}
          {showNotes && (
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t.monitor.notes_placeholder}
              rows={3}
              autoFocus
              className="w-full mt-2 px-3 py-2 rounded-card border border-primary/15 bg-secondary/25 typo-body text-foreground placeholder:text-foreground/40 resize-none outline-none focus-visible:border-primary/40"
            />
          )}
        </div>
      </div>
      <div className="border-t border-primary/10 px-3 py-2 grid grid-cols-3 gap-2 bg-secondary/10">
        <button
          onClick={() => act('rejected' as ManualReviewStatus)}
          disabled={isProcessing}
          className="flex items-center justify-center gap-1.5 py-2 rounded-modal border border-red-500/25 bg-red-500/8 text-red-400 hover:bg-red-500/15 transition-colors disabled:opacity-40"
        >
          <X className="w-4 h-4" />
          <span className="typo-heading font-medium">{t.monitor.reject}</span>
        </button>
        <button
          onClick={() => setShowNotes((s) => !s)}
          className={`flex items-center justify-center gap-1.5 py-2 rounded-modal border transition-colors ${
            showNotes ? 'border-primary/30 bg-primary/15 text-primary' : 'border-primary/15 bg-secondary/20 text-foreground hover:text-foreground'
          }`}
          title={t.monitor.toggle_notes}
        >
          <MessageSquare className="w-4 h-4" />
          <span className="typo-heading font-medium">{t.monitor.notes}</span>
        </button>
        <button
          onClick={() => act('approved' as ManualReviewStatus)}
          disabled={isProcessing}
          className="flex items-center justify-center gap-1.5 py-2 rounded-modal border border-emerald-500/25 bg-emerald-500/8 text-emerald-400 hover:bg-emerald-500/15 transition-colors disabled:opacity-40"
        >
          <Check className="w-4 h-4" />
          <span className="typo-heading font-medium">{t.monitor.approve}</span>
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity row — live process
// ---------------------------------------------------------------------------

function MonitorActivityRow({ entry, now, onNavigate }: { entry: ProcessEntry; now: number; onNavigate: () => void }) {
  const { t, tx } = useTranslation();
  const { proc } = entry;
  const [expanded, setExpanded] = useState(false);
  const isExecution = proc.domain === 'execution';
  const executionId = isExecution && expanded ? (proc.runId ?? null) : null;
  const { entries, isLive } = useReasoningTrace(executionId);
  const hasNav = !!proc.navigateTo;
  const M = processStatusMeta(proc.status);

  const handleClick = () => {
    if (hasNav) {
      navigateToProcess(proc, onNavigate);
      return;
    }
    if (isExecution && proc.status === 'running') setExpanded((v) => !v);
  };

  const trailing = proc.status === 'running'
    ? elapsedStr(proc.startedAt, now)
    : proc.status === 'queued'
      ? tx(t.monitor.queue_position, { position: (proc.queuePosition ?? 0) + 1 })
      : processStatusLabel(t, proc.status);

  return (
    <div className="border-b border-primary/8 last:border-b-0">
      <button
        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-primary/5 transition-colors text-left"
        onClick={handleClick}
      >
        <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${M.dot} ${M.pulse ? 'animate-pulse' : ''}`} />
        <div className="min-w-0 flex-1">
          <div className="typo-body text-foreground truncate">
            {proc.label ?? proc.domain}
            {proc.runId && (
              <span className="typo-caption text-foreground ml-1">({proc.runId.slice(0, 8)})</span>
            )}
          </div>
          {proc.lastEvent && (
            <div className="typo-caption text-foreground truncate">{proc.lastEvent}</div>
          )}
        </div>
        <span className={`typo-caption shrink-0 text-right ${M.text}`}>{trailing}</span>
        {hasNav && <span className="text-primary/40 typo-caption shrink-0 ml-1">&rsaquo;</span>}
      </button>
      {expanded && isExecution && (
        <div className="bg-background/50 border-t border-primary/8">
          <ReasoningTrace entries={entries} isLive={isLive} startTime={proc.startedAt} />
          {proc.costUsd > 0 && (
            <div className="px-3 pb-2 typo-caption text-foreground">
              {tx(t.monitor.tool_calls, { count: proc.toolCallCount, cost: proc.costUsd.toFixed(4) })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
