import { lazy, Suspense } from 'react';
import { TwinVariantTabs } from '../_variants/TwinVariantTabs';
import { SuspenseFallback } from '@/features/shared/components/feedback/SuspenseFallback';

const BrainAtelier = lazy(() => import('./BrainAtelier'));
const BrainConsole = lazy(() => import('./BrainConsole'));
const BrainBaseline = lazy(() => import('./BrainBaseline'));

export default function BrainPage() {
  return (
    <TwinVariantTabs storageKey="brain">
      {(variant) => (
        <Suspense fallback={<SuspenseFallback />}>
          {variant === 'atelier' && <BrainAtelier />}
          {variant === 'console' && <BrainConsole />}
          {variant === 'baseline' && <BrainBaseline />}
        </Suspense>
      )}
    </TwinVariantTabs>
  );
}
