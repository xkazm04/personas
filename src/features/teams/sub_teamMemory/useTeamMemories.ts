import { useCallback, useEffect, useRef, useState } from 'react';
import { useToastStore } from '@/stores/toastStore';
import { toastCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import {
  listTeamMemories,
  createTeamMemory,
  deleteTeamMemory,
  updateTeamMemory,
  updateTeamMemoryImportance,
  getTeamMemoryCount,
  getTeamMemoryStats,
} from '@/api/pipeline/teamMemories';
import type { TeamMemory } from '@/lib/bindings/TeamMemory';
import type { TeamMemoryStats } from '@/lib/bindings/TeamMemoryStats';
import type { CreateTeamMemoryInput } from '@/lib/bindings/CreateTeamMemoryInput';

const PAGE_SIZE = 30;

/**
 * Data layer for `TeamMemoryPanel` — list + count + stats with category /
 * search / run filters, paged loading, and CRUD handlers that confirm via
 * toast. The panel components were orphaned when the DAG canvas was retired;
 * this hook is the re-mount plumbing that lets any surface host them.
 */
export function useTeamMemories(teamId: string) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [memories, setMemories] = useState<TeamMemory[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<TeamMemoryStats | null>(null);
  // Filters live in a ref: the panel owns the filter UI state and calls
  // onFilter/onFilterByRun; we only need the current values for refetches.
  const filtersRef = useRef<{ category?: string; search?: string; runId?: string }>({});

  const refresh = useCallback(async () => {
    const { category, search, runId } = filtersRef.current;
    const [rows, count, st] = await Promise.all([
      listTeamMemories(teamId, runId, category, search, PAGE_SIZE, 0),
      getTeamMemoryCount(teamId, runId, category, search),
      getTeamMemoryStats(teamId, category, search),
    ]);
    setMemories(rows);
    setTotal(count);
    setStats(st);
  }, [teamId]);

  useEffect(() => {
    filtersRef.current = {};
    refresh().catch(toastCatch('teamMemory/useTeamMemories:initialLoad'));
  }, [refresh]);

  const onFilter = useCallback((category?: string, search?: string) => {
    filtersRef.current = { ...filtersRef.current, category, search };
    refresh().catch(toastCatch('teamMemory/useTeamMemories:filter'));
  }, [refresh]);

  const onFilterByRun = useCallback((runId: string | null) => {
    filtersRef.current = { ...filtersRef.current, runId: runId ?? undefined };
    refresh().catch(toastCatch('teamMemory/useTeamMemories:runFilter'));
  }, [refresh]);

  const onLoadMore = useCallback(async () => {
    const { category, search, runId } = filtersRef.current;
    try {
      const next = await listTeamMemories(teamId, runId, category, search, PAGE_SIZE, memories.length);
      setMemories((prev) => [...prev, ...next]);
    } catch (err) {
      toastCatch('teamMemory/useTeamMemories:loadMore')(err);
    }
  }, [teamId, memories.length]);

  const onCreate = useCallback((input: CreateTeamMemoryInput) => {
    createTeamMemory(input)
      .then(() => {
        addToast(t.pipeline.memory_created, 'success');
        return refresh();
      })
      .catch(toastCatch('teamMemory/useTeamMemories:create'));
  }, [addToast, refresh, t]);

  const onDelete = useCallback((id: string) => {
    deleteTeamMemory(id)
      .then(() => {
        addToast(t.pipeline.memory_deleted, 'success');
        return refresh();
      })
      .catch(toastCatch('teamMemory/useTeamMemories:delete'));
  }, [addToast, refresh, t]);

  const onImportanceChange = useCallback((id: string, importance: number) => {
    // Optimistic — the dots respond instantly; a failed write rolls back via refresh.
    setMemories((prev) => prev.map((m) => (m.id === id ? { ...m, importance } : m)));
    updateTeamMemoryImportance(id, importance).catch((err) => {
      toastCatch('teamMemory/useTeamMemories:importance')(err);
      refresh().catch(toastCatch('teamMemory/useTeamMemories:importanceRollback'));
    });
  }, [refresh]);

  const onEdit = useCallback((id: string, title: string, content: string, category: string, importance: number) => {
    updateTeamMemory(id, title, content, category, importance)
      .then(() => {
        addToast(t.pipeline.memory_updated, 'success');
        return refresh();
      })
      .catch(toastCatch('teamMemory/useTeamMemories:edit'));
  }, [addToast, refresh, t]);

  return { memories, total, stats, onFilter, onFilterByRun, onLoadMore, onCreate, onDelete, onImportanceChange, onEdit };
}
