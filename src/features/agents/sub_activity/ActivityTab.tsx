import { useEffect, useState, useMemo, useCallback } from 'react';
import { Activity, Play, Zap, Brain, AlertTriangle, RefreshCw, Loader2, CheckCircle2 } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { executePersona, listExecutions } from '@/api/agents/executions';
import { listMemories } from '@/api/overview/memories';
import { listManualReviews, updateManualReviewStatus } from '@/api/overview/reviews';
import { listEvents } from '@/api/overview/events';
import { formatRelativeTime, getStatusEntry, badgeClass } from '@/lib/utils/formatters';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import type { PersonaEvent } from '@/lib/types/types';
import type { PersonaMemory } from '@/lib/types/types';
import type { PersonaManualReview } from '@/lib/bindings/PersonaManualReview';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';
import DetailModal from '@/features/overview/components/dashboard/widgets/DetailModal';
import { ExecutionDetail } from '@/features/agents/sub_executions/detail/ExecutionDetail';
import { EventDetailModal } from '@/features/overview/sub_events/EventDetailModal';
import MemoryDetailModal from '@/features/overview/sub_memories/components/MemoryDetailModal';

type ActivityType = 'all' | 'execution' | 'event' | 'memory' | 'review';

interface ActivityItem {
  type: 'execution' | 'event' | 'memory' | 'review';
  id: string;
  title: string;
  subtitle: string;
  status: string;
  timestamp: string;
  raw: PersonaExecution | PersonaEvent | PersonaMemory | PersonaManualReview;
}

const TYPE_ICONS: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  execution: { icon: Play, color: 'text-blue-400', bg: 'bg-blue-500/10' },
  event: { icon: Zap, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  memory: { icon: Brain, color: 'text-violet-400', bg: 'bg-violet-500/10' },
  review: { icon: AlertTriangle, color: 'text-rose-400', bg: 'bg-rose-500/10' },
};

const FILTER_TABS: { id: ActivityType; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'execution', label: 'Executions' },
  { id: 'event', label: 'Events' },
  { id: 'memory', label: 'Memories' },
  { id: 'review', label: 'Reviews' },
];

function renderImportanceStars(status: string): string {
  const match = status.match(/(\d+)/);
  const importance = match?.[1] ? Math.min(10, Math.max(1, parseInt(match[1], 10))) : 5;
  const filled = Math.round(importance / 2);
  return '\u2605'.repeat(filled) + '\u2606'.repeat(5 - filled);
}

export function ActivityTab() {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [filter, setFilter] = useState<ActivityType>('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isLoading, setIsLoading] = useState(true);

  // Detail modal state
  const [selectedExecution, setSelectedExecution] = useState<PersonaExecution | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<PersonaEvent | null>(null);
  const [selectedMemory, setSelectedMemory] = useState<PersonaMemory | null>(null);
  const [selectedReview, setSelectedReview] = useState<PersonaManualReview | null>(null);
  const [reviewProcessing, setReviewProcessing] = useState(false);

  const personaId = selectedPersona?.id;

  // Quick Execute — fire and notify, then refresh list
  const [execState, setExecState] = useState<'idle' | 'running' | 'sent'>('idle');
  const handleQuickExecute = useCallback(async () => {
    if (!personaId || execState === 'running') return;
    setExecState('running');
    try {
      await executePersona(personaId);
      setExecState('sent');
      // Auto-reset status and refresh after brief confirmation
      setTimeout(() => { setExecState('idle'); loadData(); }, 2000);
    } catch (err) {
      console.error('Quick execute failed:', err);
      setExecState('idle');
    }
  }, [personaId, execState]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadData = useCallback(async () => {
    if (!personaId) return;
    setIsLoading(true);
    try {
      const [executions, events, memories, reviews] = await Promise.all([
        listExecutions(personaId, 50).catch(() => [] as PersonaExecution[]),
        listEvents(100).catch(() => [] as PersonaEvent[]),
        listMemories(personaId, undefined, undefined, 50).catch(() => [] as PersonaMemory[]),
        listManualReviews(personaId).catch(() => [] as PersonaManualReview[]),
      ]);

      // Filter events to this persona
      const personaEvents = events.filter(
        (e) => e.source_id === personaId || e.target_persona_id === personaId
      );

      const allItems: ActivityItem[] = [
        ...executions.map((e): ActivityItem => ({
          type: 'execution',
          id: e.id,
          title: `Execution ${e.status}`,
          subtitle: e.output_data?.slice(0, 80) || 'No output',
          status: e.status,
          timestamp: e.started_at || e.created_at,
          raw: e,
        })),
        ...personaEvents.map((e): ActivityItem => ({
          type: 'event',
          id: e.id,
          title: e.event_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          subtitle: e.source_type || 'System',
          status: e.status === 'pending' ? 'delivered' : e.status,
          timestamp: e.created_at,
          raw: e,
        })),
        ...memories.map((m): ActivityItem => ({
          type: 'memory',
          id: m.id,
          title: m.title,
          subtitle: m.category,
          status: `importance: ${m.importance}`,
          timestamp: m.created_at,
          raw: m,
        })),
        ...reviews.map((r): ActivityItem => ({
          type: 'review',
          id: r.id,
          title: r.title,
          subtitle: r.description?.slice(0, 80) || '',
          status: r.status,
          timestamp: r.created_at,
          raw: r,
        })),
      ];

      allItems.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setItems(allItems);
    } finally {
      setIsLoading(false);
    }
  }, [personaId]);

  useEffect(() => { loadData(); }, [loadData]);

  const filtered = useMemo(() => {
    let result = filter === 'all' ? items : items.filter((i) => i.type === filter);
    if (statusFilter !== 'all') {
      result = result.filter((i) => i.status.toLowerCase() === statusFilter);
    }
    return result;
  }, [items, filter, statusFilter]);

  // Available statuses for the current filter
  const availableStatuses = useMemo(() => {
    const base = filter === 'all' ? items : items.filter((i) => i.type === filter);
    const statuses = new Set(base.map((i) => i.status.toLowerCase()));
    return Array.from(statuses).sort();
  }, [items, filter]);

  const counts = useMemo(() => {
    const c: Record<ActivityType, number> = { all: items.length, execution: 0, event: 0, memory: 0, review: 0 };
    for (const item of items) c[item.type]++;
    return c;
  }, [items]);

  const handleRowClick = (item: ActivityItem) => {
    switch (item.type) {
      case 'execution': setSelectedExecution(item.raw as PersonaExecution); break;
      case 'event': setSelectedEvent(item.raw as PersonaEvent); break;
      case 'memory': setSelectedMemory(item.raw as PersonaMemory); break;
      case 'review': setSelectedReview(item.raw as PersonaManualReview); break;
    }
  };

  const handleReviewAction = async (status: ManualReviewStatus, notes?: string) => {
    if (!selectedReview) return;
    setReviewProcessing(true);
    try {
      await updateManualReviewStatus(selectedReview.id, status, notes);
      setSelectedReview(null);
      loadData();
    } finally {
      setReviewProcessing(false);
    }
  };

  if (!selectedPersona) return null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-blue-400" />
          <h3 className="typo-heading text-foreground/90">Activity</h3>
          <span className="text-xs text-muted-foreground/60">{items.length} items</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleQuickExecute}
            disabled={execState !== 'idle'}
            data-testid="activity-quick-execute-btn"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              execState === 'sent'
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-primary/10 text-primary hover:bg-primary/15 disabled:opacity-50'
            }`}
          >
            {execState === 'running' ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : execState === 'sent' ? (
              <CheckCircle2 className="w-3 h-3" />
            ) : (
              <Play className="w-3 h-3" />
            )}
            {execState === 'running' ? 'Running...' : execState === 'sent' ? 'Executed' : 'Execute'}
          </button>
          <button
            onClick={loadData}
            className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-foreground hover:bg-secondary/50 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Filter tabs + status filter */}
      <div className="flex items-center gap-3 border-b border-primary/10 pb-0">
        <div className="flex gap-1">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => { setFilter(tab.id); setStatusFilter('all'); }}
              className={`px-3 py-1.5 text-xs font-medium rounded-t-lg transition-colors ${
                filter === tab.id
                  ? 'bg-primary/10 text-primary border-b-2 border-primary'
                  : 'text-muted-foreground/70 hover:text-foreground'
              }`}
            >
              {tab.label}
              {counts[tab.id] > 0 && (
                <span className="ml-1.5 text-muted-foreground/50">({counts[tab.id]})</span>
              )}
            </button>
          ))}
        </div>
        {availableStatuses.length > 1 && (
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="ml-auto px-2 py-1 rounded-lg border border-primary/15 bg-secondary/20 text-xs text-foreground/70 outline-none"
          >
            <option value="all">All statuses</option>
            {availableStatuses.map((s) => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        )}
      </div>

      {/* Activity list */}
      {isLoading ? (
        <div className="py-8 text-center text-muted-foreground/50 text-sm">Loading activity...</div>
      ) : filtered.length === 0 ? (
        <div className="py-8 text-center text-muted-foreground/50 text-sm">No activity yet</div>
      ) : (
        <div className="border border-primary/10 rounded-xl overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[36px_1fr_100px_120px] gap-3 px-4 py-2 bg-primary/5 border-b border-primary/10 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider">
            <span></span>
            <span>Activity</span>
            <span>Status</span>
            <span>Time</span>
          </div>
          {/* Table rows */}
          {filtered.map((item, idx) => {
            const info = TYPE_ICONS[item.type] ?? TYPE_ICONS.execution!;
            const statusEntry = item.type === 'execution' ? getStatusEntry(item.status) : null;
            return (
              <div
                key={`${item.type}-${item.id}`}
                onClick={() => handleRowClick(item)}
                className={`grid grid-cols-[36px_1fr_100px_120px] gap-3 px-4 py-2.5 cursor-pointer transition-colors hover:bg-white/[0.04] items-center ${
                  idx > 0 ? 'border-t border-primary/[0.06]' : ''
                }`}
              >
                {/* Type icon */}
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center ${info.bg}`}
                  title={item.type.charAt(0).toUpperCase() + item.type.slice(1)}
                >
                  <info.icon className={`w-3.5 h-3.5 ${info.color}`} />
                </div>
                {/* Activity */}
                <div className="min-w-0">
                  <span className="text-sm font-medium text-foreground/85 truncate block">{item.title}</span>
                  <p className="text-xs text-muted-foreground/60 truncate">{item.subtitle}</p>
                </div>
                {/* Status */}
                <div>
                  {statusEntry ? (
                    <span className={`text-xs px-1.5 py-0.5 rounded ${badgeClass(statusEntry)}`}>{statusEntry.label}</span>
                  ) : item.type === 'memory' ? (
                    <span className="text-xs text-amber-400/70" title={`Importance: ${item.status}`}>
                      {renderImportanceStars(item.status)}
                    </span>
                  ) : item.type === 'review' ? (
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                      item.status === 'approved' ? 'bg-emerald-500/15 text-emerald-400' :
                      item.status === 'rejected' ? 'bg-red-500/15 text-red-400' :
                      'bg-amber-500/15 text-amber-400'
                    }`}>{item.status}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground/50">{item.status}</span>
                  )}
                </div>
                {/* Time */}
                <span className="text-xs text-muted-foreground/50 whitespace-nowrap">
                  {formatRelativeTime(item.timestamp)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail modals — reusing Overview components */}
      {selectedExecution && (
        <DetailModal
          title={`${selectedPersona.name} - Execution`}
          subtitle={`ID: ${selectedExecution.id}`}
          onClose={() => setSelectedExecution(null)}
        >
          <ExecutionDetail execution={selectedExecution} />
        </DetailModal>
      )}

      {selectedEvent && (
        <EventDetailModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      )}

      {selectedMemory && (
        <MemoryDetailModal
          memory={selectedMemory}
          personaName={selectedPersona.name}
          personaColor={selectedPersona.color || '#6366f1'}
          onClose={() => setSelectedMemory(null)}
          onDelete={() => { setSelectedMemory(null); loadData(); }}
        />
      )}

      {selectedReview && (
        <DetailModal
          title={`Review: ${selectedReview.title}`}
          subtitle={`Severity: ${selectedReview.severity} · Status: ${selectedReview.status}`}
          onClose={() => setSelectedReview(null)}
        >
          <div className="p-4 space-y-3">
            {selectedReview.description && (
              <div>
                <div className="text-xs font-mono text-muted-foreground/50 uppercase mb-1">Description</div>
                <p className="text-sm text-foreground/80 whitespace-pre-wrap">{selectedReview.description}</p>
              </div>
            )}
            {selectedReview.context_data && (
              <div>
                <div className="text-xs font-mono text-muted-foreground/50 uppercase mb-1">Context</div>
                <pre className="text-xs text-foreground/60 bg-secondary/30 rounded-lg p-2 overflow-x-auto">{selectedReview.context_data}</pre>
              </div>
            )}
            {selectedReview.status === 'pending' && (
              <div className="flex items-center gap-2 pt-2 border-t border-primary/10">
                <button
                  onClick={() => handleReviewAction('approved')}
                  disabled={reviewProcessing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  onClick={() => handleReviewAction('rejected')}
                  disabled={reviewProcessing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            )}
            {selectedReview.reviewer_notes && (
              <div>
                <div className="text-xs font-mono text-muted-foreground/50 uppercase mb-1">Reviewer Notes</div>
                <p className="text-sm text-foreground/70 italic">{selectedReview.reviewer_notes}</p>
              </div>
            )}
          </div>
        </DetailModal>
      )}
    </div>
  );
}
