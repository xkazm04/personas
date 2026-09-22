/**
 * Companions — the section's content router.
 *
 * One switch over `companionsPage`, the single persisted destination the
 * sidebar, the landing page and every deep link share. Each destination is its
 * own lazy chunk behind `lazyRetry` (never raw `React.lazy`, which caches a
 * rejected import forever) with its own ErrorBoundary, so a failed chunk fetch
 * costs one page rather than the whole section.
 *
 * `athena:*` is deliberately ONE branch: Athena's five pages live inside
 * `AthenaPage`, which reads the tab half of the page id itself, so switching
 * between her tabs never re-mounts her surface.
 */
import { Suspense } from 'react';

import { ErrorBoundary } from '@/features/shared/components/feedback/ErrorBoundary';
import { RouteChunkSkeleton } from '@/features/shared/components/layout/RouteChunkSkeleton';
import { lazyRetry } from '@/lib/lazyRetry';
import { useSystemStore } from '@/stores/systemStore';

import type { CompanionsPage as CompanionsPageId } from './types';

const LandingPage = lazyRetry(() => import('./landing/LandingPage'));
const AthenaPage = lazyRetry(() => import('./athena/AthenaPage'));
const DirectorCoachingTab = lazyRetry(() => import('./overseer/DirectorCoachingTab'));
const OverseerSetupPage = lazyRetry(() => import('./overseer/setup/OverseerSetupPage'));
const CouncilPage = lazyRetry(() => import('./curator/council/CouncilPage'));
const CuratorSetupPage = lazyRetry(() => import('./curator/setup/CuratorSetupPage'));

/** The one wrapper every destination gets: boundary, then a delayed ghost. */
function Route({ name, children }: { name: string; children: React.ReactNode }) {
  const goHome = () => useSystemStore.getState().setSidebarSection('home');
  return (
    <ErrorBoundary onGoHome={goHome} name={name}>
      <Suspense fallback={<RouteChunkSkeleton />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

function renderPage(page: CompanionsPageId) {
  if (page.startsWith('athena:')) {
    return <Route name="Athena"><AthenaPage /></Route>;
  }
  switch (page) {
    case 'overseer:reviews':
      return <Route name="Overseer"><DirectorCoachingTab /></Route>;
    case 'overseer:setup':
      return <Route name="Overseer Setup"><OverseerSetupPage /></Route>;
    case 'curator:council':
      return <Route name="Council"><CouncilPage /></Route>;
    case 'curator:setup':
      return <Route name="Curator Setup"><CuratorSetupPage /></Route>;
    default:
      return <Route name="Companions"><LandingPage /></Route>;
  }
}

export default function CompanionsPage() {
  const page = useSystemStore((s) => s.companionsPage);
  return renderPage(page);
}
