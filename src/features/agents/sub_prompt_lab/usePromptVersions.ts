import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { useToastStore } from '@/stores/toastStore';
import {
  getPromptVersions,
  tagPromptVersion,
  rollbackPromptVersion,
} from '@/api/overview/observability';
import type { PersonaPromptVersion } from '@/lib/bindings/PersonaPromptVersion';
import { filterSortGroup, type TagFilter, type SortOrder, type DateGroup } from './promptLabUtils';
import type { VersionAction } from './VersionItem';

export function usePromptVersions() {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const fetchPersonas = usePersonaStore((s) => s.fetchPersonas);
  const [versions, setVersions] = useState<PersonaPromptVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareAId, setCompareAId] = useState<string | null>(null);
  const [compareBId, setCompareBId] = useState<string | null>(null);
  const [busyVersions, setBusyVersions] = useState<Record<string, VersionAction>>({});
  const [versionErrors, setVersionErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const addToast = useToastStore((s) => s.addToast);
  const [tagFilter, setTagFilter] = useState<TagFilter>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<DateGroup>>(new Set());

  const personaId = selectedPersona?.id;
  const fetchSeqRef = useRef(0);

  const fetchVersions = useCallback(async (silent = false) => {
    if (!personaId) return;
    const seq = ++fetchSeqRef.current;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const vs = await getPromptVersions(personaId, 50);
      if (fetchSeqRef.current !== seq) return;
      setVersions(vs);
    } catch (err) {
      if (fetchSeqRef.current !== seq) return;
      setError(err instanceof Error ? err.message : 'Failed to load prompt versions');
    } finally {
      if (fetchSeqRef.current === seq && !silent) setLoading(false);
    }
  }, [personaId]);

  useEffect(() => {
    setVersions([]);
    setSelectedId(null);
    setCompareAId(null);
    setCompareBId(null);
    setError(null);
    setBusyVersions({});
    setVersionErrors({});
    fetchSeqRef.current++;
    void fetchVersions();
  }, [fetchVersions]);

  const compareA = useMemo(() => versions.find((v) => v.id === compareAId) ?? null, [versions, compareAId]);
  const compareB = useMemo(() => versions.find((v) => v.id === compareBId) ?? null, [versions, compareBId]);
  const grouped = useMemo(() => filterSortGroup(versions, tagFilter, sortOrder), [versions, tagFilter, sortOrder]);
  const filteredCount = useMemo(() => grouped.reduce((n, g) => n + g.versions.length, 0), [grouped]);

  const toggleGroupCollapse = (group: DateGroup) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group); else next.add(group);
      return next;
    });
  };

  const handleTag = async (versionId: string, tag: string) => {
    const action: VersionAction = tag === 'production' ? 'promote' : tag === 'archived' ? 'archive' : 'unarchive';
    setBusyVersions((prev) => ({ ...prev, [versionId]: action }));
    setVersionErrors((prev) => { const next = { ...prev }; delete next[versionId]; return next; });
    try {
      await tagPromptVersion(versionId, tag);
      await fetchVersions(true);
      const label = tag === 'production' ? 'Promoted to production' : tag === 'archived' ? 'Archived' : 'Unarchived';
      addToast(label, 'success');
    } catch (err) {
      setVersionErrors((prev) => ({ ...prev, [versionId]: err instanceof Error ? err.message : 'Failed to tag version' }));
    } finally {
      setBusyVersions((prev) => { const next = { ...prev }; delete next[versionId]; return next; });
    }
  };

  const handleRollback = async (versionId: string) => {
    setBusyVersions((prev) => ({ ...prev, [versionId]: 'rollback' }));
    setVersionErrors((prev) => { const next = { ...prev }; delete next[versionId]; return next; });
    try {
      await rollbackPromptVersion(versionId);
      await fetchVersions(true);
      await fetchPersonas();
      addToast('Rolled back successfully', 'success');
    } catch (err) {
      setVersionErrors((prev) => ({ ...prev, [versionId]: err instanceof Error ? err.message : 'Failed to rollback version' }));
    } finally {
      setBusyVersions((prev) => { const next = { ...prev }; delete next[versionId]; return next; });
    }
  };

  const dismissVersionError = (versionId: string) => {
    setVersionErrors((prev) => { const next = { ...prev }; delete next[versionId]; return next; });
  };

  return {
    personaId,
    versions, loading, error, setError,
    selectedId, setSelectedId,
    compareAId, setCompareAId, compareA,
    compareBId, setCompareBId, compareB,
    busyVersions, versionErrors, dismissVersionError,
    tagFilter, setTagFilter, sortOrder, setSortOrder,
    grouped, filteredCount,
    collapsedGroups, toggleGroupCollapse,
    handleTag, handleRollback,
  };
}
