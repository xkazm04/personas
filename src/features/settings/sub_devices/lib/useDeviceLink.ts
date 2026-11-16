/**
 * Wires the pure pairing reducer to the store, the IPC calls and the event
 * bridge. Everything decision-shaped lives in `pairingMachine.ts` and
 * `wizardStep.ts`; this hook is only plumbing, so the ceremony stays testable
 * without React.
 */
import { useCallback, useEffect, useMemo, useReducer } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import { createLogger } from '@/lib/log';
import { silentCatch } from '@/lib/silentCatch';
import * as devicesApi from '@/api/network/devices';
import type { DiscoveredPeer } from '@/api/network/discovery';
import {
  initialPairingState,
  isBusyWith,
  pairingReducer,
  selectIncoming,
  selectOutgoing,
  selectPendingPeerIds,
} from './pairingMachine';
import { classifyCodeConfirmFailure, classifyPairingRefusal, type PairingRefusal } from './pairingRefusal';

const logger = createLogger('device-link');

export function useDeviceLink() {
  const { t } = useTranslation();
  const st = t.sharing;
  const addToast = useToastStore((s) => s.addToast);

  const ownedDevices = useSystemStore((s) => s.ownedDevices);
  const ownedDevicesLoading = useSystemStore((s) => s.ownedDevicesLoading);
  const discoveredPeers = useSystemStore((s) => s.discoveredPeers);
  const pendingDevicePairings = useSystemStore((s) => s.pendingDevicePairings);
  const pendingSynced = useSystemStore((s) => s.pendingDevicePairingsSynced);
  const p2pUnavailable = useSystemStore((s) => s.p2pUnavailable);

  const fetchOwnedDevices = useSystemStore((s) => s.fetchOwnedDevices);
  const fetchPendingDevicePairings = useSystemStore((s) => s.fetchPendingDevicePairings);
  const fetchDiscoveredPeers = useSystemStore((s) => s.fetchDiscoveredPeers);
  const connectToPeer = useSystemStore((s) => s.connectToPeer);

  const [state, dispatch] = useReducer(pairingReducer, initialPairingState);

  // The event bridge pushes the authoritative pending list into the store; the
  // poll below is only the recovery path for an app that was closed when a
  // peer asked to pair. Both land here as the SAME transition.
  useEffect(() => {
    if (pendingSynced) dispatch({ type: 'pending-synced', pending: pendingDevicePairings });
  }, [pendingDevicePairings, pendingSynced]);

  useEffect(() => {
    void fetchOwnedDevices();
    void fetchPendingDevicePairings();
    void fetchDiscoveredPeers();
  }, [fetchOwnedDevices, fetchPendingDevicePairings, fetchDiscoveredPeers]);

  // The initiator's request vanished from the pending list: the other PC
  // either typed the code (it is owned now) or did not. Only a fresh owned
  // list can tell, so refetch it, then let `wizardStep` read the answer.
  const chosenPhase = state.chosen?.phase;
  useEffect(() => {
    if (chosenPhase !== 'settling') return;
    fetchOwnedDevices()
      .catch(silentCatch('features/settings/sub_devices/useDeviceLink:settle'))
      .finally(() => dispatch({ type: 'owned-refetched' }));
  }, [chosenPhase, fetchOwnedDevices]);

  const pairedIds = useMemo(() => new Set(ownedDevices.map((d) => d.peerId)), [ownedDevices]);
  const pendingIds = useMemo(() => selectPendingPeerIds(state), [state]);

  /** Discovered peers that are neither already paired nor mid-ceremony. */
  const linkablePeers = useMemo(
    () => discoveredPeers.filter((p) => !pairedIds.has(p.peer_id) && !pendingIds.has(p.peer_id)),
    [discoveredPeers, pairedIds, pendingIds],
  );

  const failWith = useCallback((peerId: string, displayName: string, refusal: PairingRefusal) => {
    logger.warn('Pairing action refused', { peerId, code: refusal.code, detail: refusal.detail });
    dispatch({ type: 'action-failed', peerId, displayName, refusal });
  }, []);

  const startPairing = useCallback(
    async (peer: DiscoveredPeer) => {
      dispatch({ type: 'peer-chosen', peerId: peer.peer_id, displayName: peer.display_name });
      dispatch({ type: 'action-started', peerId: peer.peer_id, action: 'request' });
      try {
        // Pairing sits on top of the authenticated handshake, so an idle peer
        // has to be connected first — otherwise the backend refuses with
        // "requires an authenticated connection" and the operator has to guess.
        if (!peer.is_connected) await connectToPeer(peer.peer_id);
        const request = await devicesApi.pairRequest(peer.peer_id);
        dispatch({ type: 'request-succeeded', request });
      } catch (err) {
        failWith(peer.peer_id, peer.display_name, classifyPairingRefusal(err));
      }
    },
    [connectToPeer, failWith],
  );

  /** The receiving PC types the code the other PC shows. */
  const confirmCode = useCallback(
    async (peerId: string, displayName: string, code: string) => {
      dispatch({ type: 'action-started', peerId, action: 'confirm' });
      try {
        const verdict = await devicesApi.confirmPairingCode(peerId, code);
        if (verdict.kind === 'paired') {
          dispatch({ type: 'confirm-succeeded', peerId, displayName });
          addToast(st.pairing_paired_toast, 'success');
          await fetchOwnedDevices();
        } else if (verdict.kind === 'mismatch') {
          dispatch({
            type: 'code-mismatch', peerId, displayName,
            attemptsLeft: verdict.attemptsLeft, withdrawn: verdict.withdrawn,
          });
        } else {
          dispatch({ type: 'code-no-pending', peerId, displayName });
        }
      } catch (err) {
        failWith(peerId, displayName, classifyCodeConfirmFailure(err));
      }
    },
    [addToast, fetchOwnedDevices, failWith, st.pairing_paired_toast],
  );

  const cancelPairing = useCallback(
    async (peerId: string, displayName: string) => {
      dispatch({ type: 'action-started', peerId, action: 'cancel' });
      try {
        await devicesApi.pairCancel(peerId);
        dispatch({ type: 'cancel-succeeded', peerId, displayName });
      } catch (err) {
        // `pair_cancel` is idempotent backend-side, so a failure here is
        // genuinely unexpected — surface it rather than pretending it worked.
        failWith(peerId, displayName, classifyPairingRefusal(err));
      }
    },
    [failWith],
  );

  const refresh = useCallback(() => {
    void fetchDiscoveredPeers();
    fetchPendingDevicePairings().catch(silentCatch('features/settings/sub_devices/useDeviceLink:refresh'));
  }, [fetchDiscoveredPeers, fetchPendingDevicePairings]);

  return {
    ownedDevices,
    ownedDevicesLoading,
    ownedPeerIds: pairedIds,
    discoveredPeers,
    linkablePeers,
    p2pUnavailable,
    pending: state.pending,
    chosen: state.chosen,
    mismatch: state.mismatch,
    outgoing: selectOutgoing(state),
    incoming: selectIncoming(state),
    outcome: state.outcome,
    pendingSynced: state.synced,
    isBusy: (peerId: string) => isBusyWith(state, peerId),
    startPairing,
    confirmCode,
    cancelPairing,
    dismissOutcome: useCallback(() => dispatch({ type: 'outcome-dismissed' }), []),
    refresh,
  };
}
