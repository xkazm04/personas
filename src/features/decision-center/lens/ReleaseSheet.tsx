/**
 * ReleaseSheet - a release's composition, READ ONLY (spark one-control, WP3):
 * the version, the items and the notes, opened by a Release card.
 *
 * bp composes and finishes releases; Personas reads (Director synthesis,
 * wave 4: "read in Personas, compose in bp"). The sheet's one primary action
 * opens bp's Release tab for the product in the system browser (Enter). When
 * bp does not answer, the sheet says it is not running and how to start it,
 * and nothing else.
 */
import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { ErrorBanner } from '@/features/shared/components/feedback/ErrorBanner';
import { KitHost } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { LensScanProduct } from '@/lib/bindings/LensScanProduct';
import { silentCatch } from '@/lib/silentCatch';

import { LensSheetFrame } from './LensSheetFrame';
import { BpNotRunning, ReleaseFacts, ReleaseItems, ReleaseNotes } from './ReleaseParts';
import { loadComposition } from './releaseCompositions';
import type { ReleaseComposition } from './releaseComposition';
import { useBpRelease } from './useBpRelease';

type Loaded = { status: 'loading' } | { status: 'ready'; comp: ReleaseComposition } | { status: 'error' };

function useComposition(product: LensScanProduct): Loaded {
  const [state, setState] = useState<Loaded>({ status: 'loading' });
  useEffect(() => {
    let cancelled = false;
    loadComposition(product)
      .then((comp) => { if (!cancelled) setState({ status: 'ready', comp }); })
      // The sheet says the store could not be read; the log keeps why.
      .catch((err: unknown) => {
        silentCatch('decisionCenter.lensRelease:sheet')(err);
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [product]);
  return state;
}

export function ReleaseSheet({ product, eyebrow, onClose }: { product: LensScanProduct; eyebrow: string; onClose: () => void }) {
  const { t } = useTranslation();
  const R = t.decisionCenter.release;
  const loaded = useComposition(product);
  const bp = useBpRelease(product.root);
  const down = bp.reach === 'down';
  const canOpen = !down && bp.url !== null;
  const open = () => { if (canOpen) void bp.open(); };

  const footer = (
    <>
      <Button variant="secondary" size="md" onClick={onClose} data-testid="lens-sheet-close">{t.decisionCenter.lens.close}</Button>
      {!down && (
        <Button
          variant="primary"
          size="md"
          onClick={open}
          disabled={!canOpen}
          aria-keyshortcuts="Enter"
          iconRight={<ExternalLink className="h-4 w-4" aria-hidden />}
          data-testid="lens-release-open-bp"
        >
          {R.open_bp}
        </Button>
      )}
    </>
  );

  return (
    <LensSheetFrame
      eyebrow={eyebrow}
      title={`${product.name} · ${R.sheet_title}`}
      onClose={onClose}
      onEnter={canOpen ? open : undefined}
      footer={footer}
      testId="lens-release-sheet"
    >
      {down ? (
        <BpNotRunning />
      ) : (
        <KitHost>
          <p className="typo-caption">{R.sheet_read_only}</p>
          {/* Born empty and kept mounted: only its text follows the read. */}
          <span className="sr-only" role="status">{loaded.status === 'loading' ? R.loading : ''}</span>
          {loaded.status === 'error' && <ErrorBanner variant="inline" message={t.decisionCenter.lens.error_store} />}
          {loaded.status === 'ready' && <ReleaseFacts comp={loaded.comp} />}
          <ReleaseItems comp={loaded.status === 'ready' ? loaded.comp : null} loading={loaded.status === 'loading'} />
          {loaded.status === 'ready' && <ReleaseNotes notes={loaded.comp.notes} />}
        </KitHost>
      )}
    </LensSheetFrame>
  );
}
