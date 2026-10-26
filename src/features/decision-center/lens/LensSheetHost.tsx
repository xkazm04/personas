/**
 * LensSheetHost - mounts the sheet a lens-scan card opened, over the deck
 * (spark one-control, WP3). Mounted once beside the deck in
 * `DecisionDeckHost`; renders nothing until `openLensSheet` sets a request.
 *
 *   build / evidence  the live blueprint drawing set at the product (an
 *                     Evidence card at the first feature waiting for triage)
 *   release           the release's read-only composition, with its one
 *                     door out to bp
 *
 * Both sheets are lazy: this host is on the startup path, and the blueprint
 * drawing engine alone was most of the always-loaded deck chunk until
 * 2026-10-25, for a sheet most sessions never open.
 */
import { Suspense } from 'react';
import { usePreloadedSections, useTranslation } from '@/i18n/useTranslation';
import { lazyRetry } from '@/lib/lazyRetry';

import { kindLabel } from '../deck/deckMeta';
import { useLensScanProducts } from '../roster/lensScanSource';
import { closeLensSheet, useLensSheetStore } from './lensSheetStore';

const LiveBlueprint = lazyRetry(() =>
  import('../blueprint/live/LiveBlueprint').then((m) => ({ default: m.LiveBlueprint })),
);
const ReleaseSheet = lazyRetry(() => import('./ReleaseSheet').then((m) => ({ default: m.ReleaseSheet })));

export function LensSheetHost() {
  const { t } = useTranslation();
  const request = useLensSheetStore((s) => s.request);
  const source = useLensScanProducts(false);
  // `decisionCenter` is an OVERLAY_SECTIONS entry: not loaded before first paint.
  usePreloadedSections(['decisionCenter'], request !== null);
  if (!request) return null;
  const product = source.products?.find((p) => p.projectId === request.projectId);
  const eyebrow = kindLabel(t.monitor, request.kind);
  if (request.kind === 'release') {
    return product ? (
      <Suspense fallback={null}>
        <ReleaseSheet product={product} eyebrow={eyebrow} onClose={closeLensSheet} />
      </Suspense>
    ) : null;
  }
  return (
    <Suspense fallback={null}>
      <LiveBlueprint
        key={request.projectId}
        projectId={request.projectId}
        name={product?.name ?? ''}
        eyebrow={eyebrow}
        focus={request.kind === 'evidence' ? 'evidence' : 'product'}
        onClose={closeLensSheet}
      />
    </Suspense>
  );
}
