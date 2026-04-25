import { lazy, Suspense } from 'react';
import { TwinVariantTabs } from '../_variants/TwinVariantTabs';
import { SuspenseFallback } from '@/features/shared/components/feedback/SuspenseFallback';

const IdentityAtelier = lazy(() => import('./IdentityAtelier'));
const IdentityConsole = lazy(() => import('./IdentityConsole'));
const IdentityBaseline = lazy(() => import('./IdentityBaseline'));

export default function IdentityPage() {
  return (
    <TwinVariantTabs storageKey="identity">
      {(variant) => (
        <Suspense fallback={<SuspenseFallback />}>
          {variant === 'atelier' && <IdentityAtelier />}
          {variant === 'console' && <IdentityConsole />}
          {variant === 'baseline' && <IdentityBaseline />}
        </Suspense>
      )}
    </TwinVariantTabs>
  );
}
