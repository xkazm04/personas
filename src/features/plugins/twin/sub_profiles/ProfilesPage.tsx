import { lazy, Suspense } from 'react';
import { TwinVariantTabs } from '../_variants/TwinVariantTabs';
import { SuspenseFallback } from '@/features/shared/components/feedback/SuspenseFallback';

const ProfilesAtelier = lazy(() => import('./ProfilesAtelier'));
const ProfilesConsole = lazy(() => import('./ProfilesConsole'));
const ProfilesBaseline = lazy(() => import('./ProfilesBaseline'));

export default function ProfilesPage() {
  return (
    <TwinVariantTabs storageKey="profiles">
      {(variant) => (
        <Suspense fallback={<SuspenseFallback />}>
          {variant === 'atelier' && <ProfilesAtelier />}
          {variant === 'console' && <ProfilesConsole />}
          {variant === 'baseline' && <ProfilesBaseline />}
        </Suspense>
      )}
    </TwinVariantTabs>
  );
}
