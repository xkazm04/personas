/**
 * The guided "Add a PC" dialog: Find -> Code -> Done on the PC that asks,
 * Approve -> Done on the PC that is asked.
 *
 * ONE state model: the pairing machine inside `useDeviceLink`. The screen is
 * `wizardStep()` of it, so the dialog advances by itself when the other PC
 * acts and never keeps a step of its own. Nothing irreversible happens before
 * the commit, which here is the typed code on the receiving PC.
 *
 * The page owns `open` (the operator asked, OR a request is waiting here). The
 * dialog also holds itself open while a run it followed has an unacknowledged
 * result, so the receiving PC still sees Done after its request left the list.
 */
import { useState } from 'react';
import { Laptop } from 'lucide-react';
import { ModalShell } from '@/features/shared/components/modals/ModalShell';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { useTranslation } from '@/i18n/useTranslation';
import type { useDeviceLink } from '../../lib/useDeviceLink';
import { isMidFlow, wizardStep, type WizardView } from '../../lib/wizardStep';
import { PairingRefusalNotice } from './PairingRefusalNotice';
import { StepRail } from './StepRail';
import { FindStep } from './FindStep';
import { CodeStep } from './CodeStep';
import { ApproveStep } from './ApproveStep';
import { DoneStep } from './DoneStep';

export type DeviceLink = ReturnType<typeof useDeviceLink>;

export interface AddPcDialogProps {
  open: boolean;
  onClose: () => void;
  link: DeviceLink;
}

/** The peer a mid-flow step is holding, which Stop pairing cancels. */
function heldPeer(view: WizardView, link: DeviceLink): { peerId: string; displayName: string } | null {
  if (view.step === 'approve') return { peerId: view.request.peerId, displayName: view.request.displayName };
  if (view.step === 'code' && link.chosen) return { peerId: link.chosen.peerId, displayName: link.chosen.displayName };
  return null;
}

export function AddPcDialog({ open, onClose, link }: AddPcDialogProps) {
  const { t, tx } = useTranslation();
  const st = t.sharing;
  const [confirmStop, setConfirmStop] = useState(false);

  const view = wizardStep({
    pending: link.pending,
    ownedPeerIds: link.ownedPeerIds,
    chosen: link.chosen,
    outcome: link.outcome,
  });
  const held = heldPeer(view, link);
  const outcome = link.outcome;
  const holdOpen = link.chosen !== null || (outcome !== null && outcome.kind !== 'cancelled');
  const refusal = outcome?.kind === 'refused' ? outcome : null;

  const finish = () => {
    setConfirmStop(false);
    link.dismissOutcome();
    onClose();
  };
  const requestClose = () => (isMidFlow(view) ? setConfirmStop(true) : finish());
  const stop = async () => {
    if (held) await link.cancelPairing(held.peerId, held.displayName);
    finish();
  };

  return (
    <>
      <ModalShell
        isOpen={open || holdOpen}
        onClose={requestClose}
        titleId="add-pc-title"
        width="sm"
        portal
        icon={<Laptop className="w-6 h-6" />}
        title={view.path === 'responder' ? st.wizard_title_incoming : st.wizard_title}
        status={<StepRail path={view.path} current={view.step} />}
      >
        <div data-testid="add-pc-wizard" data-step={view.step} className="space-y-4">
          {refusal && <PairingRefusalNotice outcome={refusal} onDismiss={link.dismissOutcome} />}

          {view.step === 'find' && (
            <FindStep
              peers={link.linkablePeers}
              isBusy={link.isBusy}
              onPick={(peer) => void link.startPairing(peer)}
              onRefresh={link.refresh}
            />
          )}
          {view.step === 'code' && (
            <CodeStep
              displayName={view.displayName}
              fingerprint={view.request?.fingerprint ?? null}
              busy={held !== null && link.isBusy(held.peerId)}
              onCancel={() => held && void link.cancelPairing(held.peerId, held.displayName)}
            />
          )}
          {view.step === 'approve' && (
            <ApproveStep
              request={view.request}
              busy={link.isBusy(view.request.peerId)}
              attemptsLeft={link.mismatch?.peerId === view.request.peerId ? link.mismatch.attemptsLeft : null}
              onSubmit={(code) => void link.confirmCode(view.request.peerId, view.request.displayName, code)}
              onDecline={() => void link.cancelPairing(view.request.peerId, view.request.displayName)}
            />
          )}
          {view.step === 'done' && <DoneStep kind={view.kind} displayName={view.displayName} onBack={finish} />}
        </div>
      </ModalShell>

      {confirmStop && held && (
        <ConfirmDialog
          title={st.wizard_stop_title}
          body={tx(st.wizard_stop_body, { device: held.displayName })}
          confirmLabel={st.wizard_stop_confirm}
          cancelLabel={st.wizard_stop_keep}
          danger
          onConfirm={stop}
          onCancel={() => setConfirmStop(false)}
        />
      )}
    </>
  );
}
