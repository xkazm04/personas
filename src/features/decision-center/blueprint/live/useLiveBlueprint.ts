/**
 * useLiveBlueprint - one lens-scan product as the drawing's data and actions
 * (spark one-control, Stage 2, WP3).
 *
 * The product row comes from the Decision Center's shared products read
 * (`roster/lensScanSource`); the snapshot from `getLensScanSnapshot`. Every
 * action is `liveActions` over `@/api/lensScan`, and every write re-reads the
 * products so the deck's counts and cards follow the decision.
 *
 * States: `loading` (the sheet shows its ghost), `ready`, or `error` with the
 * typed kind (`loadError`), which offers nothing that writes.
 */
import { useEffect, useMemo, useState } from 'react';

import { packGroups, packItems } from '@/lib/lensScan/compare';
import { silentCatch } from '@/lib/silentCatch';
import type { ScanSnapshot } from '@/lib/lensScan/wire';

import { refreshLensScanProducts, useLensScanProducts } from '../../roster/lensScanSource';
import type { BlueprintActions, BlueprintData, BlueprintProduct } from '../source';
import { createLiveActions, readBlueprint } from './liveActions';
import { loadErrorKind, type LoadErrorKind } from './loadError';

export type LiveBlueprint =
  | { status: 'loading' }
  | { status: 'error'; kind: LoadErrorKind }
  | { status: 'ready'; data: BlueprintData; actions: BlueprintActions };

/**
 * The feature an Evidence card opens at: the first item waiting for triage
 * (`done` or `failed`) in the first open pack that has one, in the store's
 * own pack and item order (`compare.ts packGroups`, `packItems`).
 */
export function evidenceFeature(scan: Pick<ScanSnapshot, 'packs' | 'proposals'>): string | undefined {
  for (const g of packGroups(scan)) {
    if (g.pack.status !== 'open') continue;
    const first = packItems(scan, g.pack.id).find((p) => p.status === 'done' || p.status === 'failed');
    if (first) return first.feature;
  }
  return undefined;
}

const onChanged = () => {
  void refreshLensScanProducts();
};

export function useLiveBlueprint(projectId: string): LiveBlueprint {
  const source = useLensScanProducts(false);
  const row = source.products?.find((p) => p.projectId === projectId) ?? null;
  // The row object changes on every products read; the product it names does not.
  const name = row?.name;
  const root = row?.root;
  const product = useMemo<BlueprintProduct | null>(
    () => (name !== undefined && root !== undefined ? { projectId, name, root } : null),
    [projectId, name, root],
  );
  const [state, setState] = useState<LiveBlueprint>({ status: 'loading' });

  useEffect(() => {
    if (!product) return;
    let cancelled = false;
    setState({ status: 'loading' });
    const actions = createLiveActions(product, onChanged);
    readBlueprint(product)
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data, actions });
      })
      .catch((err: unknown) => {
        // The sheet says which cause; the log keeps the error itself.
        silentCatch(`decisionCenter.liveBlueprint:${product.projectId}`)(err);
        if (!cancelled) setState({ status: 'error', kind: loadErrorKind(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [product]);

  // A product the products read no longer lists (removed, or its store gone) cannot load.
  if (!product) return source.settled && source.products ? { status: 'error', kind: 'store' } : { status: 'loading' };
  return state;
}
