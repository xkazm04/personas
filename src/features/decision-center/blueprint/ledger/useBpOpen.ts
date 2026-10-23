// The ledger's doors out to bp (operator decision, spark bp-fidelity): releases are cut, built, finished and undone in
// bp, and lenses are authored there, so every such control opens bp in the system browser at this product, through
// the Release card's own link helper (lens/bpLink.ts + lens/useBpRelease.ts). No write leaves Personas from here.
import { useCallback } from 'react';
import { openExternalUrl } from '@/api/system/system';
import { silentCatch } from '@/lib/silentCatch';
import { useBpRelease, type BpReach } from '../../lens/useBpRelease';
import { useSheet } from '../controller/SheetContext';

export interface BpOpen {
  /** bp's Release tab at this product, once the setting is read. */
  releaseUrl: string | null;
  reach: BpReach;
  openRelease(): void;
  /** bp's findings ledger at this product (where its Lenses panel lives). */
  openLedger(): void;
}

/** bp's ledger page: the Release tab's URL without the tab. */
export function ledgerUrlOf(releaseUrl: string): string {
  const u = new URL(releaseUrl);
  u.searchParams.delete('tab');
  return u.toString();
}

export function useBpOpen(): BpOpen {
  const { data } = useSheet();
  const bp = useBpRelease(data.product.root);
  const openLedger = useCallback(() => {
    if (!bp.url) return;
    openExternalUrl(ledgerUrlOf(bp.url)).catch(silentCatch('decisionCenter.blueprint.ledger:openBp'));
  }, [bp.url]);
  return { releaseUrl: bp.url, reach: bp.reach, openRelease: () => void bp.open(), openLedger };
}
