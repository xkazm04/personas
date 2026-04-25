import { lazy, Suspense } from 'react';
import { TwinVariantTabs } from '../_variants/TwinVariantTabs';
import { SuspenseFallback } from '@/features/shared/components/feedback/SuspenseFallback';

const KnowledgeAtelier = lazy(() => import('./KnowledgeAtelier'));
const KnowledgeConsole = lazy(() => import('./KnowledgeConsole'));
const KnowledgeBaseline = lazy(() => import('./KnowledgeBaseline'));

export default function KnowledgePage() {
  return (
    <TwinVariantTabs storageKey="knowledge">
      {(variant) => (
        <Suspense fallback={<SuspenseFallback />}>
          {variant === 'atelier' && <KnowledgeAtelier />}
          {variant === 'console' && <KnowledgeConsole />}
          {variant === 'baseline' && <KnowledgeBaseline />}
        </Suspense>
      )}
    </TwinVariantTabs>
  );
}
