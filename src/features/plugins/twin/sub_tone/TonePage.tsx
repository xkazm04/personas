import { lazy, Suspense } from 'react';
import { TwinVariantTabs } from '../_variants/TwinVariantTabs';
import { SuspenseFallback } from '@/features/shared/components/feedback/SuspenseFallback';

const ToneAtelier = lazy(() => import('./ToneAtelier'));
const ToneConsole = lazy(() => import('./ToneConsole'));
const ToneBaseline = lazy(() => import('./ToneBaseline'));

export default function TonePage() {
  return (
    <TwinVariantTabs storageKey="tone">
      {(variant) => (
        <Suspense fallback={<SuspenseFallback />}>
          {variant === 'atelier' && <ToneAtelier />}
          {variant === 'console' && <ToneConsole />}
          {variant === 'baseline' && <ToneBaseline />}
        </Suspense>
      )}
    </TwinVariantTabs>
  );
}
