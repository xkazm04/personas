/**
 * Which screen the Add-a-PC wizard shows, DERIVED from the pairing machine.
 *
 * The wizard owns no step counter. The step is a pure function of what the
 * backend says is pending, what this PC chose, which PCs it owns and the last
 * outcome, so it moves on by itself when the OTHER PC acts (types the code,
 * declines, runs out) and a re-mount lands on the same screen.
 *
 *   find --pick--> code (this PC asked)        --vanished+refetched--> done
 *   (a request arrives) --> approve (other PC asked) --verdict--> done
 *
 * The initiator is never told how its request ended; its pending entry just
 * disappears. So `settled` + `ownedPeerIds` decide it: the peer is now owned
 * -> paired, otherwise -> declined (declined and ran out look the same from
 * here, and the copy says so).
 */
import type { DevicePairingRequest } from '@/api/network/devices';
import type { ChosenPeer, PairingOutcome } from './pairingMachine';

export type WizardStepId = 'find' | 'code' | 'approve' | 'done';
export type WizardPath = 'initiator' | 'responder';
export type DoneKind = 'paired' | 'declined' | 'wrongCode';

export type WizardView =
  | { step: 'find'; path: 'initiator' }
  | { step: 'code'; path: 'initiator'; request: DevicePairingRequest | null; displayName: string }
  | { step: 'approve'; path: 'responder'; request: DevicePairingRequest }
  | { step: 'done'; path: WizardPath; kind: DoneKind; displayName: string };

export interface WizardStepInput {
  pending: readonly DevicePairingRequest[];
  ownedPeerIds: ReadonlySet<string>;
  chosen: ChosenPeer | null;
  outcome: PairingOutcome | null;
}

/** The steps the rail shows, per path. */
export const WIZARD_RAIL: Record<WizardPath, readonly WizardStepId[]> = {
  initiator: ['find', 'code', 'done'],
  responder: ['approve', 'done'],
};

const DONE_OUTCOMES = new Set<PairingOutcome['kind']>(['paired', 'declined', 'wrongCode']);

/** Paired vs declined for a choice whose request vanished and whose refetch landed. */
export function initiatorVerdict(peerId: string, ownedPeerIds: ReadonlySet<string>): 'paired' | 'declined' {
  return ownedPeerIds.has(peerId) ? 'paired' : 'declined';
}

export function wizardStep({ pending, ownedPeerIds, chosen, outcome }: WizardStepInput): WizardView {
  // 1. A held terminal outcome from an action taken HERE (the typed-code
  //    verdict on the responder, or a confirm).
  if (outcome && DONE_OUTCOMES.has(outcome.kind)) {
    const path: WizardPath = chosen?.peerId === outcome.peerId ? 'initiator' : 'responder';
    return { step: 'done', path, kind: outcome.kind as DoneKind, displayName: outcome.displayName };
  }

  // 2. The initiator's request resolved elsewhere.
  if (chosen?.phase === 'settled') {
    return {
      step: 'done',
      path: 'initiator',
      kind: initiatorVerdict(chosen.peerId, ownedPeerIds),
      displayName: chosen.displayName,
    };
  }

  // 3. This PC asked and is waiting (including the refetch window, so the
  //    code does not flicker away before the verdict).
  if (chosen && chosen.phase !== 'requesting') {
    return { step: 'code', path: 'initiator', request: chosen.request, displayName: chosen.displayName };
  }

  // 4. Another PC asked this one.
  const incoming = pending.find((p) => p.role === 'responder');
  if (incoming) return { step: 'approve', path: 'responder', request: incoming };

  // 5. Nothing in flight (or the request is still being sent: Find shows the
  //    pressed button busy).
  return { step: 'find', path: 'initiator' };
}

/** Code and Approve hold a live request: closing them must ask first. */
export function isMidFlow(view: WizardView): boolean {
  return view.step === 'code' || view.step === 'approve';
}
