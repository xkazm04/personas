/**
 * useAdoptionAutoResolve — auto-swaps connectors to credentialed alternatives
 * and auto-resolves single-match credentials for required connectors.
 *
 * Extracted from AdoptionWizardContext to isolate auto-matching concerns.
 */
import { useEffect, useRef, type MutableRefObject } from 'react';
import type { CredentialMetadata } from '@/lib/types/types';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { AdoptionDraft } from '@/stores/slices/system/uiSlice';
import { getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import type { RequiredConnector } from '../steps/connect/ConnectStep';
import type { useAdoptReducer } from './useAdoptReducer';
import type { AdoptState } from './useAdoptReducer';

interface UseAdoptionAutoResolveOptions {
  state: AdoptState;
  wizard: ReturnType<typeof useAdoptReducer>;
  requiredConnectors: RequiredConnector[];
  liveCredentials: CredentialMetadata[];
  manualSelectionsRef: MutableRefObject<Set<string>>;
  autoResolveRanRef: MutableRefObject<boolean>;
  storedDraft: AdoptionDraft | null;
  draftRestoredRef: MutableRefObject<boolean>;
  review: PersonaDesignReview | null;
}

export function useAdoptionAutoResolve({
  state,
  wizard,
  requiredConnectors,
  liveCredentials,
  manualSelectionsRef,
  autoResolveRanRef,
  storedDraft,
  draftRestoredRef,
  review,
}: UseAdoptionAutoResolveOptions) {
  // ── Auto-swap connectors without credentials ──
  const autoSwapRanRef = useRef(false);
  useEffect(() => {
    if (state.step !== 'choose' || autoSwapRanRef.current || !requiredConnectors.length) return;
    const BUILTIN = new Set(['personas_messages', 'personas_database']);
    const credServiceTypes = new Set(liveCredentials.map((c) => c.service_type));

    const swaps: Array<{ original: string; replacement: string }> = [];
    for (const rc of requiredConnectors) {
      if (BUILTIN.has(rc.activeName) || credServiceTypes.has(rc.activeName)) continue;
      if (!rc.roleMembers || rc.roleMembers.length <= 1) continue;

      const alternatives = rc.roleMembers
        .filter((m) => m !== rc.activeName && (credServiceTypes.has(m) || BUILTIN.has(m)))
        .sort((a, b) => getConnectorMeta(a).label.toLowerCase().localeCompare(getConnectorMeta(b).label.toLowerCase()));

      if (alternatives.length > 0) {
        swaps.push({ original: rc.name, replacement: alternatives[0]! });
      }
    }

    if (swaps.length > 0) {
      autoSwapRanRef.current = true;
      for (const { original, replacement } of swaps) {
        wizard.swapConnector(original, replacement);
      }
    }
  }, [requiredConnectors, liveCredentials, state.step, wizard]);

  // ── Auto-resolve credentials ──
  // Deferred until after draft restore completes to avoid race condition (Phase E fix — Area #11)
  useEffect(() => {
    if (state.step !== 'choose' || state.autoResolved || !requiredConnectors.length) return;
    if (autoResolveRanRef.current) return;
    // Wait for draft restore to complete before auto-resolving
    if (storedDraft && storedDraft.reviewId === review?.id && !draftRestoredRef.current) return;

    const autoMap: Record<string, string> = {};
    for (const rc of requiredConnectors) {
      if (manualSelectionsRef.current.has(rc.activeName)) continue;
      const matches = liveCredentials.filter((c) => c.service_type === rc.activeName);
      if (matches.length === 1) {
        autoMap[rc.activeName] = matches[0]!.id;
      } else {
        continue;
      }
    }
    autoResolveRanRef.current = true;
    for (const [name, id] of Object.entries(autoMap)) {
      wizard.setConnectorCredential(name, id);
    }
    wizard.setAutoResolved(true);
  }, [requiredConnectors, liveCredentials, state.step, state.autoResolved, wizard, storedDraft, review, manualSelectionsRef, autoResolveRanRef, draftRestoredRef]);
}
