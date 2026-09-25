/**
 * Contest — the in-app home of the /contest method.
 *
 * The page is the Season Ledger (`./ledger`): every contest on one line, a
 * contest's seats and sorting bench one level in, one variant's live frame one
 * level further. It won the owner's /contest round of 2026-09-25 against five
 * other redesigns and replaced the Arena. The ledger draws its own header (it
 * carries the search, Standings and New contest), so the page is only the
 * container and the lazy boundary.
 */
import { Suspense } from 'react';

import { ContentBox } from '@/features/shared/components/layout/ContentLayout';
import { RouteChunkSkeleton } from '@/features/shared/components/layout/RouteChunkSkeleton';
import { lazyRetry } from '@/lib/lazyRetry';

const Ledger = lazyRetry(() => import('./ledger'));

export default function ContestPage() {
  return (
    <ContentBox data-testid="contest-page">
      <Suspense fallback={<RouteChunkSkeleton />}>
        <Ledger />
      </Suspense>
    </ContentBox>
  );
}
