import { lazy, Suspense } from 'react';
import { TwinVariantTabs } from '../_variants/TwinVariantTabs';
import { SuspenseFallback } from '@/features/shared/components/feedback/SuspenseFallback';

const TrainingAtelier = lazy(() => import('./TrainingAtelier'));
const TrainingConsole = lazy(() => import('./TrainingConsole'));
const TrainingBaseline = lazy(() => import('./TrainingBaseline'));

export default function TrainingPage() {
  return (
    <TwinVariantTabs storageKey="training">
      {(variant) => (
        <Suspense fallback={<SuspenseFallback />}>
          {variant === 'atelier' && <TrainingAtelier />}
          {variant === 'console' && <TrainingConsole />}
          {variant === 'baseline' && <TrainingBaseline />}
        </Suspense>
      )}
    </TwinVariantTabs>
  );
}
