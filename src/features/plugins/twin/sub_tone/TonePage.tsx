import { lazy, Suspense } from 'react';
import { TwinVariantTabs } from '../variants/TwinVariantTabs';
import { RouteChunkSkeleton } from '@/features/shared/components/layout/RouteChunkSkeleton';

const ToneAtelier = lazy(() => import('./ToneAtelier'));
const ToneConsole = lazy(() => import('./ToneConsole'));
const ToneBaseline = lazy(() => import('./ToneBaseline'));

export default function TonePage() {
  return (
    <TwinVariantTabs storageKey="tone">
      {(variant) => (
        <Suspense fallback={<RouteChunkSkeleton />}>
          {variant === 'atelier' && <ToneAtelier />}
          {variant === 'console' && <ToneConsole />}
          {variant === 'baseline' && <ToneBaseline />}
        </Suspense>
      )}
    </TwinVariantTabs>
  );
}
