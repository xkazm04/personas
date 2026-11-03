/**
 * LiveBlueprint - the blueprint drawing set over a real lens-scan product
 * (spark one-control, Stage 2, WP3), opened by a Build or Evidence card.
 *
 * While the snapshot reads, the frame shows a ghost under its own chrome
 * (loading pattern v2); a product that cannot open shows which of the three
 * causes it is (store unreadable, lens-scan not installed, node missing) and
 * offers nothing that writes, only Close. Once it reads, `BlueprintSheet`
 * mounts over the deck exactly as WP4a's harness surface mounts it, with the
 * live actions (`useLiveBlueprint`). An Evidence card opens it at the first
 * feature waiting for triage, where the L4 sheet's compare panel lives.
 */
import { useMemo } from 'react';
import { Button } from '@/features/shared/components/buttons';
import { DocumentGhost } from '@/features/shared/components/document/DocumentGhost';
import { ErrorBanner } from '@/features/shared/components/feedback/ErrorBanner';
import { useTranslation } from '@/i18n/useTranslation';

import { LensSheetFrame } from '../../lens/LensSheetFrame';
import type { FocusPlace } from '../model/focus';
import { BlueprintSheet } from '../BlueprintSheet';
import type { LoadErrorKind } from './loadError';
import { evidenceFeature, useLiveBlueprint } from './useLiveBlueprint';

export function LiveBlueprint({ projectId, name, eyebrow, focus, place, onClose }: {
  projectId: string;
  /** The product's name, for the frame while the snapshot reads. */
  name: string;
  eyebrow: string;
  /** `evidence`: open at the first feature waiting for triage. */
  focus: 'product' | 'evidence';
  /** Open at a place bp's shared focus moved to (the follower). */
  place?: FocusPlace | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const L = t.decisionCenter.lens;
  const live = useLiveBlueprint(projectId);
  const scan = live.status === 'ready' ? live.data.scan : null;
  const initialFeature = useMemo(() => (scan && focus === 'evidence' ? evidenceFeature(scan) : undefined), [scan, focus]);

  if (live.status === 'ready') {
    return <BlueprintSheet data={live.data} actions={live.actions} initialFeature={initialFeature} {...(place ? { initialPlace: place } : {})} onClose={onClose} />;
  }
  const close = <Button variant="secondary" size="md" onClick={onClose} data-testid="lens-sheet-close">{L.close}</Button>;
  return (
    <LensSheetFrame eyebrow={eyebrow} title={name} onClose={onClose} footer={close} testId={`lens-blueprint-${live.status}`}>
      {live.status === 'loading' ? (
        <div aria-busy="true" aria-label={L.loading}>
          <DocumentGhost testId="lens-blueprint-ghost" />
        </div>
      ) : (
        <>
          <ErrorBanner variant="inline" message={errorWords(L, live.kind)} />
          <p className="typo-body text-foreground">{L.error_hint}</p>
        </>
      )}
    </LensSheetFrame>
  );
}

function errorWords(L: ReturnType<typeof useTranslation>['t']['decisionCenter']['lens'], kind: LoadErrorKind): string {
  switch (kind) {
    case 'registry': return L.error_registry;
    case 'node': return L.error_node;
    case 'store': return L.error_store;
  }
}
