import { useCallback, useMemo } from 'react';
import { useConfirmDestructive } from '@/features/shared/components/overlays/ConfirmDestructiveModal';
import { BlastRadiusPanelLazy } from '@/features/overview/components/BlastRadiusPanel';
import { getPersonaBlastRadius, bulkDeletePersonas, archivePersona, restorePersona } from '@/api/agents/personas';
import { useAgentStore } from '@/stores/agentStore';
import { useToastStore } from '@/stores/toastStore';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { mapWithConcurrency } from '@/lib/concurrency';
import { useTranslation } from '@/i18n/useTranslation';
import { createLogger } from '@/lib/log';
import type { Persona } from '@/lib/bindings/Persona';

const logger = createLogger('persona-overview');

/**
 * Re-read the roster after a mutation has already landed. Best-effort: the
 * mutation's own result decides what the user is told, so a refresh that fails
 * leaves a breadcrumb and never turns a delete/archive/restore that succeeded
 * into a reported failure (or a skipped success toast).
 */
function refreshRoster(context: string): Promise<void> {
  return useAgentStore.getState().fetchPersonas().catch(silentCatch(context));
}

interface UsePersonaActionsArgs {
  personas: Persona[];
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  deletePersona: (id: string) => Promise<void>;
  selectPersona: (id: string) => void;
  isDraft: (p: Persona) => boolean;
}

/**
 * CRUD callbacks for the persona overview list. Pulled out of the page so the
 * page component stays focused on rendering. Returns the confirm modal state
 * via `modal` so the caller can mount `<ConfirmDestructiveModal {...modal} />`.
 */
export function usePersonaActions({
  personas,
  selectedIds,
  setSelectedIds,
  deletePersona,
  selectPersona,
  isDraft,
}: UsePersonaActionsArgs) {
  const { t, tx } = useTranslation();
  const { modal, confirm } = useConfirmDestructive();

  const handleDelete = useCallback(
    (id: string) => {
      const persona = personas.find((p) => p.id === id);
      if (!persona) return;
      if (persona.trust_origin === 'system') {
        useToastStore.getState().addToast(t.agents.overview_actions.system_persona_undeletable, 'warning');
        return;
      }
      confirm({
        title: t.agents.overview_actions.delete_agent,
        message: t.agents.overview_actions.delete_agent_message,
        details: [{ label: t.common.name, value: persona.name }],
        blastRadius: <BlastRadiusPanelLazy fetcher={() => getPersonaBlastRadius(id)} />,
        requireTypedConfirmation: persona.name,
        onConfirm: async () => {
          try {
            await deletePersona(id);
            setSelectedIds((prev) => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
          } catch (err) {
            logger.error('Failed to delete persona', { error: err });
            // Surface the failure — the confirm modal has already closed, so
            // without a toast the row silently stays and the user learns nothing.
            toastCatch('PersonaOverviewActions:delete')(err);
          }
        },
      });
    },
    [personas, confirm, t.agents.overview_actions.delete_agent, t.agents.overview_actions.delete_agent_message, t.agents.overview_actions.system_persona_undeletable, t.common.name, deletePersona, setSelectedIds],
  );

  // Bulk delete via the single `bulk_delete_personas` IPC (one round-trip
  // instead of N sequential deletes) with a per-id outcome toast. Refreshes the
  // store afterward so the roster reflects every removal.
  const runBulkDelete = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      try {
        const outcomes = await bulkDeletePersonas(ids);
        const deleted = outcomes.filter((o) => o.status === 'deleted').length;
        const protectedCount = outcomes.filter((o) => o.status === 'protected').length;
        const failed = outcomes.filter((o) => o.status === 'failed').length;
        await refreshRoster('PersonaOverviewActions:bulkDeleteRefresh');
        if (failed > 0 || protectedCount > 0) {
          useToastStore.getState().addToast(
            tx(t.agents.overview_actions.bulk_delete_partial, { deleted, skipped: protectedCount + failed }),
            'warning',
          );
        } else {
          useToastStore.getState().addToast(
            tx(t.agents.overview_actions.bulk_delete_done, { deleted }),
            'success',
          );
        }
      } catch (err) {
        logger.error('Bulk delete failed', { error: err });
        useToastStore.getState().addToast(t.agents.overview_actions.bulk_delete_failed, 'error');
      }
    },
    [tx, t.agents.overview_actions.bulk_delete_partial, t.agents.overview_actions.bulk_delete_done, t.agents.overview_actions.bulk_delete_failed],
  );

  const handleBatchDelete = useCallback(() => {
    if (selectedIds.size === 0) return;
    // System personas (the Director) can't be deleted — drop them from the batch.
    const ids = [...selectedIds].filter(
      (id) => personas.find((p) => p.id === id)?.trust_origin !== 'system',
    );
    const count = ids.length;
    if (count === 0) {
      // Only system personas were selected. Say why nothing happens, the way
      // the single-row delete does, instead of ignoring the click.
      useToastStore.getState().addToast(t.agents.overview_actions.system_persona_undeletable, 'warning');
      return;
    }
    // Same guard the single delete carries: what depends on these agents, and a
    // typed confirmation (the name for one, the count for several).
    // A large selection would fire one IPC per agent at once; four at a time.
    const fetchBlastRadius = () =>
      mapWithConcurrency(ids, 4, (id) => getPersonaBlastRadius(id)).then((groups) => groups.flat());
    // One agent types its name; several (or a name we no longer hold) type the count.
    const single = count === 1 ? personas.find((p) => p.id === ids[0]) : undefined;
    confirm({
      title: tx(t.agents.overview_actions.delete_agents, { count }),
      message: tx(t.agents.overview_actions.delete_agents_message, { count }),
      blastRadius: <BlastRadiusPanelLazy fetcher={fetchBlastRadius} />,
      requireTypedConfirmation: single ? single.name : String(count),
      onConfirm: async () => {
        setSelectedIds(new Set());
        await runBulkDelete(ids);
      },
    });
  }, [personas, selectedIds, confirm, tx, t.agents.overview_actions.delete_agents, t.agents.overview_actions.delete_agents_message, t.agents.overview_actions.system_persona_undeletable, setSelectedIds, runBulkDelete]);

  const draftIds = useMemo(
    () => personas.filter((p) => isDraft(p)).map((p) => p.id),
    [personas, isDraft],
  );

  const handleDeleteDrafts = useCallback(() => {
    if (draftIds.length === 0) return;
    const count = draftIds.length;
    confirm({
      title: tx(t.agents.overview_actions.delete_drafts, { count }),
      message: tx(t.agents.overview_actions.delete_drafts_message, { count }),
      onConfirm: async () => {
        await runBulkDelete(draftIds);
      },
    });
  }, [draftIds, confirm, tx, t.agents.overview_actions.delete_drafts, t.agents.overview_actions.delete_drafts_message, runBulkDelete]);

  // Bulk archive/restore of the current selection. Archive preserves all
  // history; system personas are skipped server-side (they error) so we filter
  // them out up front for a clean count.
  const handleBatchArchive = useCallback(async () => {
    const ids = [...selectedIds].filter(
      (id) => personas.find((p) => p.id === id)?.trust_origin !== 'system',
    );
    if (ids.length === 0) return;
    let ok = 0;
    let firstErr: unknown = null;
    for (const id of ids) {
      try {
        await archivePersona(id);
        ok += 1;
      } catch (err) {
        logger.error('Failed to archive persona', { id, error: err });
        firstErr ??= err;
      }
    }
    setSelectedIds(new Set());
    await refreshRoster('PersonaOverviewActions:batchArchiveRefresh');
    if (ok > 0) {
      useToastStore.getState().addToast(tx(t.agents.overview_actions.archived_done, { count: ok }), 'success');
    }
    // Partial/total failure previously reported unconditional success with the
    // ok count ("Archived 0 persona(s)"); surface the first error instead.
    if (firstErr !== null) toastCatch('PersonaOverviewActions:batchArchive')(firstErr);
  }, [selectedIds, personas, setSelectedIds, tx, t.agents.overview_actions.archived_done]);

  const handleBatchRestore = useCallback(async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    let ok = 0;
    let firstErr: unknown = null;
    for (const id of ids) {
      try {
        await restorePersona(id);
        ok += 1;
      } catch (err) {
        logger.error('Failed to restore persona', { id, error: err });
        firstErr ??= err;
      }
    }
    setSelectedIds(new Set());
    await refreshRoster('PersonaOverviewActions:batchRestoreRefresh');
    if (ok > 0) {
      useToastStore.getState().addToast(tx(t.agents.overview_actions.restored_done, { count: ok }), 'success');
    }
    if (firstErr !== null) toastCatch('PersonaOverviewActions:batchRestore')(firstErr);
  }, [selectedIds, setSelectedIds, tx, t.agents.overview_actions.restored_done]);

  const handleEdit = useCallback((id: string) => selectPersona(id), [selectPersona]);

  return { modal, handleDelete, handleBatchDelete, handleDeleteDrafts, handleBatchArchive, handleBatchRestore, handleEdit, draftIds };
}
