import { useMemo, useState } from 'react';
import {
  AlertTriangle, Zap, RefreshCw, CheckCircle, BookOpen,
  ChevronDown, ChevronRight, Tag, Search, Loader2, Shield,
} from 'lucide-react';
import type { HealingTimelineEvent } from '@/lib/bindings/HealingTimelineEvent';
import { SEVERITY_COLORS, HEALING_CATEGORY_COLORS, badgeClass } from '@/lib/utils/formatters';

interface HealingTimelineProps {
  events: HealingTimelineEvent[];
  loading: boolean;
  onSelectIssue?: (issueId: string) => void;
}

// Group events by chain_id into resilience narratives
interface ChainGroup {
  chainId: string;
  events: HealingTimelineEvent[];
  trigger: HealingTimelineEvent | undefined;
  outcome: HealingTimelineEvent | undefined;
}

const EVENT_ICONS: Record<string, typeof AlertTriangle> = {
  trigger: AlertTriangle,
  classify: Tag,
  retry: RefreshCw,
  ai_heal: Search,
  outcome: CheckCircle,
  knowledge: BookOpen,
};

const EVENT_COLORS: Record<string, { dot: string; line: string; bg: string; text: string }> = {
  trigger: { dot: 'bg-red-500', line: 'bg-red-500/30', bg: 'bg-red-500/10', text: 'text-red-400' },
  classify: { dot: 'bg-amber-500', line: 'bg-amber-500/30', bg: 'bg-amber-500/10', text: 'text-amber-400' },
  retry: { dot: 'bg-cyan-500', line: 'bg-cyan-500/30', bg: 'bg-cyan-500/10', text: 'text-cyan-400' },
  ai_heal: { dot: 'bg-violet-500', line: 'bg-violet-500/30', bg: 'bg-violet-500/10', text: 'text-violet-400' },
  outcome: { dot: 'bg-emerald-500', line: 'bg-emerald-500/30', bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  knowledge: { dot: 'bg-blue-500', line: 'bg-blue-500/30', bg: 'bg-blue-500/10', text: 'text-blue-400' },
};

function getOutcomeColors(status: string | null) {
  switch (status) {
    case 'auto_healed':
    case 'resolved':
      return { dot: 'bg-emerald-500', bg: 'bg-emerald-500/10', text: 'text-emerald-400' };
    case 'circuit_breaker':
      return { dot: 'bg-red-500', bg: 'bg-red-500/10', text: 'text-red-400' };
    case 'retrying':
      return { dot: 'bg-amber-500', bg: 'bg-amber-500/10', text: 'text-amber-400' };
    default:
      return { dot: 'bg-orange-500', bg: 'bg-orange-500/10', text: 'text-orange-400' };
  }
}

function formatTimestamp(ts: string) {
  const d = new Date(ts);
  const age = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60));
  if (age < 1) return 'just now';
  if (age < 24) return `${age}h ago`;
  return `${Math.floor(age / 24)}d ago`;
}

function ChainCard({ group, onSelectIssue }: { group: ChainGroup; onSelectIssue?: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);

  const outcomeStatus = group.outcome?.status ?? 'open';
  const outcomeStyle = getOutcomeColors(outcomeStatus);
  const triggerSev = group.trigger?.severity ?? 'medium';
  const sevBadge = SEVERITY_COLORS[triggerSev] ?? SEVERITY_COLORS.medium!;
  const retryCount = group.events.filter(e => e.eventType === 'retry').length;
  const catColor = HEALING_CATEGORY_COLORS[group.trigger?.category ?? ''];

  return (
    <div className="rounded-xl border border-primary/10 bg-secondary/10 overflow-hidden transition-all">
      {/* Chain Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors text-left"
      >
        {expanded
          ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/70 flex-shrink-0" />
          : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/70 flex-shrink-0" />
        }
        {/* Status dot */}
        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${outcomeStyle.dot} ${
          outcomeStatus === 'retrying' ? 'animate-pulse' : ''
        }`} />

        {/* Title */}
        <span className="flex-1 text-sm text-foreground/80 truncate min-w-0">
          {group.trigger?.title ?? group.chainId}
        </span>

        {/* Badges */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {group.trigger?.isCircuitBreaker && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono uppercase rounded-md border bg-red-500/15 text-red-400 border-red-500/25">
              <Zap className="w-2.5 h-2.5" /> breaker
            </span>
          )}
          {retryCount > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono rounded-md bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <RefreshCw className="w-2.5 h-2.5" /> {retryCount}
            </span>
          )}
          <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-mono uppercase rounded-md ${badgeClass(sevBadge)}`}>
            {triggerSev}
          </span>
          {catColor && (
            <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-mono uppercase rounded-md border ${catColor.bg} ${catColor.text} ${catColor.border}`}>
              {group.trigger?.category}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground/60 ml-1">
            {group.trigger ? formatTimestamp(group.trigger.timestamp) : ''}
          </span>
        </div>
      </button>

      {/* Expanded Timeline */}
      {expanded && (
        <div className="px-4 pb-4">
          <div className="relative ml-5">
            {/* Vertical timeline line */}
            <div className="absolute left-[5px] top-0 bottom-0 w-px bg-primary/10" />

            {group.events.map((event) => {
              const baseColors = event.eventType === 'outcome'
                ? { ...EVENT_COLORS.outcome, ...getOutcomeColors(event.status) }
                : EVENT_COLORS[event.eventType] ?? EVENT_COLORS.trigger;
              const colors = baseColors ?? { dot: '', bg: '', text: '' };
              const Icon = EVENT_ICONS[event.eventType] ?? AlertTriangle;

              return (
                <div key={event.id} className="relative flex gap-3 pb-3 last:pb-0">
                  {/* Timeline dot */}
                  <div className="relative flex-shrink-0 z-10">
                    <div className={`w-[11px] h-[11px] rounded-full border-2 border-background ${colors.dot} ${
                      event.eventType === 'retry' && event.status === 'running' ? 'animate-pulse' : ''
                    }`} />
                  </div>

                  {/* Content */}
                  <div className={`flex-1 min-w-0 rounded-lg px-3 py-2 ${colors.bg} transition-colors ${
                    event.issueId && onSelectIssue ? 'cursor-pointer hover:brightness-110' : ''
                  }`}
                    onClick={event.issueId && event.eventType === 'trigger' && onSelectIssue
                      ? () => onSelectIssue(event.issueId!)
                      : undefined
                    }
                  >
                    <div className="flex items-center gap-2 mb-0.5">
                      <Icon className={`w-3 h-3 flex-shrink-0 ${colors.text}`} />
                      <span className={`text-xs font-mono uppercase ${colors.text}`}>
                        {event.eventType.replace('_', ' ')}
                      </span>
                      <span className="text-[10px] text-muted-foreground/50 ml-auto">
                        {formatTimestamp(event.timestamp)}
                      </span>
                    </div>
                    <p className="text-sm text-foreground/80 leading-relaxed">{event.title}</p>
                    {event.description !== event.title && (
                      <p className="text-xs text-muted-foreground/70 mt-0.5 line-clamp-2">{event.description}</p>
                    )}
                    {event.suggestedFix && (
                      <div className="mt-1.5 px-2 py-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/15">
                        <p className="text-xs text-emerald-400/80">{event.suggestedFix}</p>
                      </div>
                    )}
                    {event.retryCount != null && event.retryCount > 0 && (
                      <span className="inline-flex items-center gap-1 mt-1 text-[10px] text-cyan-400/70">
                        <RefreshCw className="w-2.5 h-2.5" /> retry #{event.retryCount}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function KnowledgeCard({ events }: { events: HealingTimelineEvent[] }) {
  const [expanded, setExpanded] = useState(false);

  if (events.length === 0) return null;

  return (
    <div className="rounded-xl border border-blue-500/15 bg-blue-500/5 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-500/5 transition-colors text-left"
      >
        {expanded
          ? <ChevronDown className="w-3.5 h-3.5 text-blue-400/70 flex-shrink-0" />
          : <ChevronRight className="w-3.5 h-3.5 text-blue-400/70 flex-shrink-0" />
        }
        <BookOpen className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
        <span className="text-sm font-medium text-blue-300">Knowledge Base</span>
        <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-blue-500/15 text-blue-400 ml-1">
          {events.length}
        </span>
        <span className="text-xs text-blue-400/50 ml-auto">
          Patterns influencing healing decisions
        </span>
      </button>
      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {events.map((event) => (
            <div key={event.id} className="flex items-start gap-2.5 px-3 py-2 rounded-lg bg-blue-500/5">
              <Shield className="w-3 h-3 text-blue-400/60 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground/80">{event.title}</p>
                <p className="text-xs text-muted-foreground/60 mt-0.5">{event.description}</p>
                {event.suggestedFix && (
                  <p className="text-xs text-blue-400/60 mt-0.5">{event.suggestedFix}</p>
                )}
              </div>
              <span className="text-[10px] text-muted-foreground/50 flex-shrink-0">
                {formatTimestamp(event.timestamp)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function HealingTimeline({ events, loading, onSelectIssue }: HealingTimelineProps) {
  const { chains, knowledgeEvents } = useMemo(() => {
    const knowledgeEvents = events.filter(e => e.eventType === 'knowledge');
    const issueEvents = events.filter(e => e.eventType !== 'knowledge');

    // Group by chainId
    const chainMap = new Map<string, HealingTimelineEvent[]>();
    for (const event of issueEvents) {
      const group = chainMap.get(event.chainId);
      if (group) group.push(event);
      else chainMap.set(event.chainId, [event]);
    }

    // Build chain groups sorted by timestamp of trigger
    const chains: ChainGroup[] = [];
    for (const [chainId, chainEvents] of chainMap) {
      // Sort events within chain: trigger -> classify -> retry(s) -> outcome
      const order: Record<string, number> = { trigger: 0, classify: 1, retry: 2, ai_heal: 3, outcome: 4 };
      chainEvents.sort((a, b) => {
        const oa = order[a.eventType] ?? 2;
        const ob = order[b.eventType] ?? 2;
        if (oa !== ob) return oa - ob;
        return a.timestamp.localeCompare(b.timestamp);
      });

      chains.push({
        chainId,
        events: chainEvents,
        trigger: chainEvents.find(e => e.eventType === 'trigger'),
        outcome: chainEvents.find(e => e.eventType === 'outcome'),
      });
    }

    // Sort chains: most recent trigger first
    chains.sort((a, b) => {
      const ta = a.trigger?.timestamp ?? '';
      const tb = b.trigger?.timestamp ?? '';
      return tb.localeCompare(ta);
    });

    return { chains, knowledgeEvents };
  }, [events]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
        <span className="ml-2 text-sm text-muted-foreground">Loading timeline...</span>
      </div>
    );
  }

  if (chains.length === 0 && knowledgeEvents.length === 0) {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="text-center flex flex-col items-center">
          <div className="w-14 h-14 rounded-xl bg-emerald-500/10 border border-emerald-500/20 shadow-inner flex items-center justify-center mb-4 opacity-70">
            <CheckCircle className="w-6 h-6 text-emerald-400" />
          </div>
          <p className="text-sm font-medium text-foreground/80">No healing events</p>
          <p className="text-sm text-muted-foreground mt-1">Run analysis to build the resilience timeline.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 py-2">
      {chains.map((group) => (
        <ChainCard key={group.chainId} group={group} onSelectIssue={onSelectIssue} />
      ))}
      <KnowledgeCard events={knowledgeEvents} />
    </div>
  );
}
