// MonitorDrawer — the top-down triage drawer for one persona.
//
// Slides DOWN from the top over the Monitor grid (the grid stays mounted).
// Three switchable sections — Reviews, Messages, Activity — opened directly
// to whichever badge the user clicked on the card.

import { useState, useMemo } from 'react';
import { X, Check, Clock, Mail, AlertCircle, Zap } from 'lucide-react';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import ReasoningTrace from '@/features/shared/components/layout/ReasoningTrace';
import { useReasoningTrace } from '@/hooks/execution/useReasoningTrace';
import { useExecutionScope } from '@/hooks/execution/useExecutionScope';
import { useTranslation } from '@/i18n/useTranslation';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { getUseCases } from '@/features/agents/sub_use_cases/libs/useCaseHelpers';
import { toDisplayUseCase } from '@/features/agents/sub_use_cases/components/recipes-prototype/shared/displayUseCase';
import { MonitorCapabilities } from './MonitorCapabilities';
import { DrawerReviewCard } from './DrawerReviewCard';
import { navigateToProcess } from './navigateToProcess';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';
import type { PersonaReport } from '@/lib/bindings/PersonaReport';
import {
  SEVERITY_META, severityBucket, processStatusMeta, processStatusLabel, elapsedStr,
  type PersonaCardModel, type ProcessEntry, type DrawerSection,
} from './monitorModel';

interface MonitorDrawerProps {
  card: PersonaCardModel;
  initialSection: DrawerSection;
  /** Raw `design_context` JSON of the selected persona — source of capabilities. */
  designContext: string | null;
  /**
   * True while ANY review write is in flight. PRESENTATIONAL ONLY — it is the
   * drawer-wide hint (see the tab strip), never a control's guard. Guarding a
   * button on it is what made approving one review disable every other row.
   */
  isProcessing: boolean;
  /** Narrow query onto the hook's per-review keyed ledger — the real guard. */
  isReviewInFlight: (id: string, intent?: string) => boolean;
  now: number;
  onReviewAction: (id: string, status: ManualReviewStatus, notes?: string) => void | Promise<void>;
  onDispatchAction?: (id: string, action: string) => void | Promise<void>;
  onMarkRead: (id: string) => void;
  onClose: () => void;
}

export function MonitorDrawer({
  card, initialSection, designContext, isProcessing, isReviewInFlight, now,
  onReviewAction, onDispatchAction, onMarkRead, onClose,
}: MonitorDrawerProps) {
  const { t, tx } = useTranslation();
  const [section, setSection] = useState<DrawerSection>(initialSection);

  const useCases = useMemo(
    () => getUseCases(designContext).map((uc) => toDisplayUseCase(uc)),
    [designContext],
  );

  const sortedReviews = useMemo(
    () => [...card.reviews].sort(
      (a, b) => SEVERITY_META[severityBucket(a.severity)].rank - SEVERITY_META[severityBucket(b.severity)].rank,
    ),
    [card.reviews],
  );
  const sortedMessages = useMemo(
    () => [...card.messages].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [card.messages],
  );
  const sortedProcesses = useMemo(() => {
    const order: Record<string, number> = { input_required: 0, draft_ready: 1, running: 2, queued: 3 };
    return [...card.processes].sort((a, b) => (order[a.proc.status] ?? 9) - (order[b.proc.status] ?? 9));
  }, [card.processes]);

  const tabs: Array<{ id: DrawerSection; label: string; count: number }> = [
    { id: 'reviews', label: t.monitor.reviews, count: sortedReviews.length },
    { id: 'messages', label: t.monitor.messages, count: sortedMessages.length },
    { id: 'activity', label: t.monitor.activity, count: sortedProcesses.length },
    { id: 'capabilities', label: t.monitor.capabilities, count: useCases.length },
  ];

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
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-modal border border-primary/15 text-foreground hover:text-foreground hover:bg-secondary/30 transition-colors"
          title={t.monitor.close_hint}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Section tabs */}
      <div className="flex-shrink-0 flex items-center gap-1 px-4 py-2 border-b border-primary/8 bg-secondary/10">
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            onClick={() => setSection(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-modal typo-heading font-medium transition-colors ${
              section === tab.id
                ? 'bg-primary/15 text-primary border border-primary/25'
                : 'text-foreground hover:bg-secondary/40 border border-transparent'
            }`}
          >
            {tab.label}
            <span className={`typo-caption tabular-nums ${section === tab.id ? 'text-primary' : 'text-foreground/60'}`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Section body.
          `aria-busy` is the ONLY thing the drawer-wide `isProcessing` drives:
          a hint that a write is somewhere in flight. It disables nothing — the
          per-review ledger owns every control's busy state. */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4" aria-busy={isProcessing || undefined}>
        {section === 'reviews' && (
          sortedReviews.length === 0 ? (
            <EmptySection icon={AlertCircle} text={t.monitor.no_reviews} />
          ) : (
            <div className="space-y-3">
              {sortedReviews.map((review) => (
                <DrawerReviewCard
                  key={review.id}
                  review={review}
                  personaName={card.personaName}
                  isReviewInFlight={isReviewInFlight}
                  onAction={onReviewAction}
                  onDispatchAction={onDispatchAction}
                />
              ))}
            </div>
          )
        )}

        {section === 'messages' && (
          sortedMessages.length === 0 ? (
            <EmptySection icon={Mail} text={t.monitor.no_messages} />
          ) : (
            <div className="space-y-2.5">
              {sortedMessages.map((message) => (
                <DrawerMessageCard key={message.id} message={message} onMarkRead={onMarkRead} />
              ))}
            </div>
          )
        )}

        {section === 'activity' && (
          sortedProcesses.length === 0 ? (
            <EmptySection icon={Clock} text={t.monitor.no_activity} />
          ) : (
            <div className="rounded-card border border-primary/10 bg-secondary/15 overflow-hidden">
              {sortedProcesses.map((entry) => (
                <MonitorActivityRow key={entry.key} entry={entry} now={now} onNavigate={onClose} />
              ))}
            </div>
          )
        )}

        {section === 'capabilities' && (
          useCases.length === 0 ? (
            <EmptySection icon={Zap} text={t.monitor.no_capabilities} />
          ) : (
            <MonitorCapabilities personaId={card.personaId} useCases={useCases} />
          )
        )}
      </div>
    </>
  );
}

function EmptySection({ icon: Icon, text }: { icon: React.ComponentType<{ className?: string }>; text: string }) {
  return (
    <div className="h-full min-h-[160px] flex flex-col items-center justify-center gap-2 text-center">
      <div className="w-11 h-11 rounded-full bg-secondary/40 border border-primary/10 flex items-center justify-center">
        <Icon className="w-5 h-5 text-foreground" />
      </div>
      <p className="typo-body text-foreground">{text}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message card
// ---------------------------------------------------------------------------

function DrawerMessageCard({ message, onMarkRead }: { message: PersonaReport; onMarkRead: (id: string) => void }) {
  const { t } = useTranslation();
  const isHighPriority = message.priority === 'high' || message.priority === 'urgent';
  return (
    <div className="rounded-card border border-primary/10 bg-secondary/20 px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-modal border border-cyan-500/25 bg-cyan-500/10 flex items-center justify-center flex-shrink-0">
          <Mail className="w-4 h-4 text-cyan-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            {isHighPriority && (
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
            )}
            <Clock className="w-3 h-3 text-foreground" />
            <span className="typo-caption text-foreground">{formatRelativeTime(message.created_at)}</span>
          </div>
          {message.title && (
            <h5 className="typo-body font-semibold text-foreground leading-snug">{message.title}</h5>
          )}
          <p className="typo-body text-foreground/85 whitespace-pre-wrap leading-relaxed mt-1">{message.content}</p>
        </div>
        <button
          type="button"
          onClick={() => onMarkRead(message.id)}
          className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-modal border border-primary/15 bg-secondary/20 typo-heading font-medium text-foreground hover:bg-secondary/45 transition-colors"
        >
          <Check className="w-3.5 h-3.5" />
          {t.monitor.mark_read}
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
  useExecutionScope(executionId, executionId ? proc.personaId ?? null : null);
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
        type="button"
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
