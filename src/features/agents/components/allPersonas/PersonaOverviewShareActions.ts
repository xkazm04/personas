import { useCallback } from 'react';
import { duplicatePersona, exportPersona } from '@/api/agents/personas';
import { useAgentStore } from '@/stores/agentStore';
import { useToastStore } from '@/stores/toastStore';
import { toastCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import { createLogger } from '@/lib/log';

const logger = createLogger('persona-overview-share');

interface UsePersonaShareActionsArgs {
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}

/**
 * Copy / hand-off actions for the persona roster: duplicate and export.
 *
 * Both IPCs already existed and neither had a roster consumer -
 * `duplicatePersona` was reachable only through the Command Palette and
 * `exportPersona` had no UI caller at all - so a variant or a hand-off
 * required keyboard-shortcut literacy. The toasts mirror the palette's,
 * including the copied-wiring counts the command already returns.
 *
 * Kept out of `usePersonaActions` so neither file grows past the size limit;
 * the page composes both.
 */
export function usePersonaShareActions({ selectedIds, setSelectedIds }: UsePersonaShareActionsArgs) {
  const { t, tx } = useTranslation();

  const duplicateOne = useCallback(
    async (id: string) => {
      const r = await duplicatePersona(id);
      const wiring = r.triggersCopied + r.subscriptionsCopied;
      useToastStore.getState().addToast(
        wiring > 0
          ? tx(t.agents.duplicate.done_with_wiring, {
              name: r.name,
              triggers: r.triggersCopied,
              subscriptions: r.subscriptionsCopied,
            })
          : tx(t.agents.duplicate.done, { name: r.name }),
        'success',
      );
    },
    [tx, t.agents.duplicate.done, t.agents.duplicate.done_with_wiring],
  );

  const handleDuplicate = useCallback(
    async (id: string) => {
      try {
        await duplicateOne(id);
        await useAgentStore.getState().fetchPersonas();
      } catch (err) {
        logger.error('Failed to duplicate persona', { id, error: err });
        toastCatch('PersonaOverviewShareActions:duplicate', t.agents.duplicate.failed)(err);
      }
    },
    [duplicateOne, t.agents.duplicate.failed],
  );

  const handleBatchDuplicate = useCallback(async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    let firstErr: unknown = null;
    for (const id of ids) {
      try {
        await duplicateOne(id);
      } catch (err) {
        logger.error('Failed to duplicate persona', { id, error: err });
        firstErr ??= err;
      }
    }
    setSelectedIds(new Set());
    await useAgentStore.getState().fetchPersonas();
    if (firstErr !== null) toastCatch('PersonaOverviewShareActions:batchDuplicate', t.agents.duplicate.failed)(firstErr);
  }, [selectedIds, setSelectedIds, duplicateOne, t.agents.duplicate.failed]);

  /** Opens the save dialog. A `false` result means the user cancelled - that is
   *  not a failure and must not toast as one. */
  const handleExport = useCallback(
    async (id: string) => {
      try {
        const saved = await exportPersona(id);
        if (saved) {
          useToastStore.getState().addToast(t.settings.portability.exported, 'success');
        }
      } catch (err) {
        logger.error('Failed to export persona', { id, error: err });
        toastCatch('PersonaOverviewShareActions:export', t.settings.portability.export_failed)(err);
      }
    },
    [t.settings.portability.exported, t.settings.portability.export_failed],
  );

  return { handleDuplicate, handleBatchDuplicate, handleExport };
}
