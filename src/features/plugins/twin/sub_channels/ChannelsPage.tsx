import { lazy, Suspense } from 'react';
import { TwinVariantTabs } from '../_variants/TwinVariantTabs';
import { SuspenseFallback } from '@/features/shared/components/feedback/SuspenseFallback';

const ChannelsAtelier = lazy(() => import('./ChannelsAtelier'));
const ChannelsConsole = lazy(() => import('./ChannelsConsole'));
const ChannelsBaseline = lazy(() => import('./ChannelsBaseline'));

export default function ChannelsPage() {
  return (
    <TwinVariantTabs storageKey="channels">
      {(variant) => (
        <Suspense fallback={<SuspenseFallback />}>
          {variant === 'atelier' && <ChannelsAtelier />}
          {variant === 'console' && <ChannelsConsole />}
          {variant === 'baseline' && <ChannelsBaseline />}
        </Suspense>
      )}
    </TwinVariantTabs>
  );
}
