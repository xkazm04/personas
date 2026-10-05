// Bulk selection + bulk archive for the Manage table.
//
// Archive flows through `updateProject({ status: 'archived' })` per id so it
// reuses the existing slice action and SQL repository path rather than adding a
// bulk command. Extracted from `ProjectManagerPage` 2026-10-05.
import { useCallback, useMemo, useState } from 'react';

import { silentCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { useSystemStore } from '@/stores/systemStore';

import type { Project } from './projectManagerTypes';

/** The archive toast copy, resolved by the caller so this hook stays i18n-free. */
export interface SelectionCopy {
  success: string;
  partial: string;
}

export function useProjectSelection(projects: Project[], copy: SelectionCopy) {
  const storeUpdateProject = useSystemStore((s) => s.updateProject);
  const addToast = useToastStore((s) => s.addToast);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [archiving, setArchiving] = useState(false);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const selectableIds = useMemo(
    () => projects.filter((p) => p.status !== 'archived').map((p) => p.id),
    [projects],
  );
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));
  const toggleSelectAll = useCallback(() => {
    if (allSelected) clearSelection();
    else setSelectedIds(new Set(selectableIds));
  }, [allSelected, selectableIds, clearSelection]);

  const bulkArchive = useCallback(async () => {
    if (selectedIds.size === 0 || archiving) return;
    setArchiving(true);
    let ok = 0, fail = 0;
    try {
      for (const id of selectedIds) {
        try {
          await storeUpdateProject(id, { status: 'archived' });
          ok++;
        } catch (err) {
          // The toast below reports HOW MANY failed; this is the only place the
          // per-id reason survives, so it goes to Sentry rather than into a
          // counter.
          silentCatch('ProjectManager:bulkArchive')(err);
          fail++;
        }
      }
      if (ok > 0) addToast(copy.success.replace('{count}', String(ok)), 'success');
      if (fail > 0) addToast(copy.partial.replace('{failed}', String(fail)), 'error');
      clearSelection();
    } finally {
      setArchiving(false);
    }
  }, [selectedIds, archiving, storeUpdateProject, addToast, copy.success, copy.partial, clearSelection]);

  return {
    selectedIds, archiving, selectableIds, allSelected,
    toggleSelection, toggleSelectAll, clearSelection, bulkArchive,
  };
}
