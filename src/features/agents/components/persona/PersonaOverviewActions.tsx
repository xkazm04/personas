import { useCallback, useMemo } from 'react';
import { useConfirmDestructive } from '@/features/shared/components/overlays/ConfirmDestructiveModal';
import { getPersonaBlastRadius } from '@/api/agents/personas';
import { createLogger } from '@/lib/log';
import type { Persona } from '@/lib/bindings/Persona';

const logger = createLogger('persona-overview');

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
  const { modal, confirm } = useConfirmDestructive();

  const handleDelete = useCallback(
    (id: string) => {
      const persona = personas.find((p) => p.id === id);
      if (!persona) return;
      confirm({
        title: 'Delete Agent',
        message: 'This agent and all its configuration will be permanently removed.',
        details: [{ label: 'Name', value: persona.name }],
        blastRadiusFetcher: () => getPersonaBlastRadius(id),
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
          }
        },
      });
    },
    [personas, deletePersona, confirm, setSelectedIds],
  );

  const handleBatchDelete = useCallback(() => {
    if (selectedIds.size === 0) return;
    const ids = [...selectedIds];
    const count = ids.length;
    confirm({
      title: `Delete ${count} Agent${count > 1 ? 's' : ''}`,
      message: `${count} agent${count > 1 ? 's' : ''} and all their configuration will be permanently removed.`,
      onConfirm: async () => {
        setSelectedIds(new Set());
        for (const id of ids) {
          try {
            await deletePersona(id);
          } catch (err) {
            logger.error('Failed to delete persona', { id, error: err });
          }
        }
      },
    });
  }, [selectedIds, deletePersona, confirm, setSelectedIds]);

  const draftIds = useMemo(
    () => personas.filter((p) => isDraft(p)).map((p) => p.id),
    [personas, isDraft],
  );

  const handleDeleteDrafts = useCallback(() => {
    if (draftIds.length === 0) return;
    const count = draftIds.length;
    confirm({
      title: `Delete ${count} Draft${count > 1 ? 's' : ''}`,
      message: `${count} draft agent${count > 1 ? 's' : ''} will be permanently removed.`,
      onConfirm: async () => {
        for (const id of draftIds) {
          try {
            await deletePersona(id);
          } catch (err) {
            logger.error('Failed to delete draft persona', { id, error: err });
          }
        }
      },
    });
  }, [draftIds, deletePersona, confirm]);

  const handleEdit = useCallback((id: string) => selectPersona(id), [selectPersona]);

  return { modal, handleDelete, handleBatchDelete, handleDeleteDrafts, handleEdit, draftIds };
}
