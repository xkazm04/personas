import { useCallback } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { useConfirmDestructive, type ConfirmDestructiveConfig } from '@/features/shared/components/overlays/ConfirmDestructiveModal';

export interface ConfirmedRemoteActionConfig {
  /** Modal title, e.g. "Undeploy". */
  title: string;
  /** Label for the confirm button; defaults to the title. */
  confirmLabel?: string;
  /** Rows naming the target, so the user says back WHAT is about to change.
   * The shape is the modal's own - one authority for it, not a restatement. */
  details: NonNullable<ConfirmDestructiveConfig['details']>;
}

/**
 * Confirmation gate for a remote write whose blast radius reaches beyond this
 * device: undeploying an endpoint other systems call, deleting a trigger the
 * orchestrator will otherwise keep firing. The registry's remote-action-consent
 * technique ranks confirmation by (action x target); a monitor's read-mostly
 * surface trains the user that clicking is free, so the write affordances must
 * break that training in proportion to what they can break. Until 2026-09-07
 * the bulk toolbar confirmed a delete while the single-row Undeploy / Delete
 * controls beside it fired on one click.
 *
 * `confirmThen` resolves when the action settles, or resolves `undefined` at
 * once on cancel, so a caller that tracks busy state around it keeps working.
 * Render `<ConfirmDestructiveModal {...modal} />` once in the host component.
 */
export function useConfirmedRemoteAction() {
  const { t } = useTranslation();
  const { modal, confirm } = useConfirmDestructive();

  const confirmThen = useCallback(
    <T,>(config: ConfirmedRemoteActionConfig, action: () => Promise<T>): Promise<T | undefined> =>
      new Promise<T | undefined>((resolve, reject) => {
        confirm({
          title: config.title,
          message: t.common.confirm_destructive_cannot_undo,
          confirmLabel: config.confirmLabel ?? config.title,
          details: config.details,
          onConfirm: () => { action().then(resolve, reject); },
          onCancel: () => resolve(undefined),
        });
      }),
    [confirm, t],
  );

  return { modal, confirmThen };
}
