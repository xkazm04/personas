/**
 * LensSheetHost - mounts the sheet a lens-scan card opened, over the deck
 * (spark one-control, WP3). Mounted once beside the deck in
 * `DecisionDeckHost`; renders nothing until `openLensSheet` sets a request.
 *
 *   build / evidence  the live blueprint drawing set at the product (an
 *                     Evidence card at the first feature waiting for triage)
 *   release           the release's read-only composition, with its one
 *                     door out to bp
 */
import { useTranslation } from '@/i18n/useTranslation';

import { LiveBlueprint } from '../blueprint/live/LiveBlueprint';
import { kindLabel } from '../deck/deckMeta';
import { useLensScanProducts } from '../roster/lensScanSource';
import { ReleaseSheet } from './ReleaseSheet';
import { closeLensSheet, useLensSheetStore } from './lensSheetStore';

export function LensSheetHost() {
  const { t } = useTranslation();
  const request = useLensSheetStore((s) => s.request);
  const source = useLensScanProducts(false);
  if (!request) return null;
  const product = source.products?.find((p) => p.projectId === request.projectId);
  const eyebrow = kindLabel(t.monitor, request.kind);
  if (request.kind === 'release') {
    return product ? <ReleaseSheet product={product} eyebrow={eyebrow} onClose={closeLensSheet} /> : null;
  }
  return (
    <LiveBlueprint
      key={request.projectId}
      projectId={request.projectId}
      name={product?.name ?? ''}
      eyebrow={eyebrow}
      focus={request.kind === 'evidence' ? 'evidence' : 'product'}
      onClose={closeLensSheet}
    />
  );
}
