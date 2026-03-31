import { useEffect, useState, useMemo, useCallback } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { listExecutions } from '@/api/agents/executions';
import { listMemories } from '@/api/overview/memories';
import { listManualReviews } from '@/api/overview/reviews';
import { listEvents } from '@/api/overview/events';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import type { PersonaEvent } from '@/lib/types/types';
import type { PersonaMemory } from '@/lib/types/types';
import type { PersonaManualReview } from '@/lib/bindings/PersonaManualReview';
import type { ActivityItem, ActivityType } from './activityTypes';
import { ActivityHeader } from './ActivityHeader';
import { ActivityFilters } from './ActivityFilters';
import { ActivityList } from './ActivityList';
import { useActivityModals } from './ActivityModals';

export function ActivityTab() {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [filter, setFilter] = useState<ActivityType>('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isLoading, setIsLoading] = useState(true);

  const personaId = selectedPersona?.id;

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

      const personaEvents = events.filter(
        (e) => e.source_id === personaId || e.target_persona_id === personaId
      );

      const allItems: ActivityItem[] = [
        ...executions.map((e): ActivityItem => ({
          type: 'execution', id: e.id,
          title: `Execution ${e.status}`,
          subtitle: e.output_data?.slice(0, 80) || 'No output',
          status: e.status,
          timestamp: e.started_at || e.created_at,
          raw: e,
        })),
        ...personaEvents.map((e): ActivityItem => ({
          type: 'event', id: e.id,
          title: e.event_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          subtitle: e.source_type || 'System',
          status: e.status === 'pending' ? 'delivered' : e.status,
          timestamp: e.created_at,
          raw: e,
        })),
        ...memories.map((m): ActivityItem => ({
          type: 'memory', id: m.id,
          title: m.title,
          subtitle: m.category,
          status: `importance: ${m.importance}`,
          timestamp: m.created_at,
          raw: m,
        })),
        ...reviews.map((r): ActivityItem => ({
          type: 'review', id: r.id,
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
    if (statusFilter !== 'all') result = result.filter((i) => i.status.toLowerCase() === statusFilter);
    return result;
  }, [items, filter, statusFilter]);

  const availableStatuses = useMemo(() => {
    const base = filter === 'all' ? items : items.filter((i) => i.type === filter);
    return Array.from(new Set(base.map((i) => i.status.toLowerCase()))).sort();
  }, [items, filter]);

  const counts = useMemo(() => {
    const c: Record<ActivityType, number> = { all: items.length, execution: 0, event: 0, memory: 0, review: 0 };
    for (const item of items) c[item.type]++;
    return c;
  }, [items]);

  const { handleRowClick, modals } = useActivityModals({
    personaName: selectedPersona?.name ?? '',
    personaColor: selectedPersona?.color || '#6366f1',
    onDataChanged: loadData,
  });

  if (!selectedPersona) return null;

  return (
    <div className="space-y-4">
      <ActivityHeader
        personaId={selectedPersona.id}
        itemCount={items.length}
        isLoading={isLoading}
        onRefresh={loadData}
      />
      <ActivityFilters
        filter={filter}
        statusFilter={statusFilter}
        counts={counts}
        availableStatuses={availableStatuses}
        onFilterChange={setFilter}
        onStatusFilterChange={setStatusFilter}
      />
      <ActivityList
        items={filtered}
        isLoading={isLoading}
        onRowClick={handleRowClick}
      />
      {modals}
    </div>
  );
}
