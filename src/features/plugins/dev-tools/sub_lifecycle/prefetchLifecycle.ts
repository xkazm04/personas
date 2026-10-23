// Sidebar intent for Projects > Lifecycle: warm the page's chunk before the
// click lands. The page lands on the portfolio (every project), which reads
// its snapshots itself a few at a time; warming them all on a hover would walk
// every repo's git for a click that may not come, so only a project the Lens
// is already focused on is warmed. The sidebar
// reaches this module through a dynamic import, so none of the page's code
// rides in the main bundle. Both halves are deduped: the chunk is the module
// loader's own promise, and the snapshot skips a copy fetched moments ago and
// joins a request already in flight.
import { silentCatch } from '@/lib/silentCatch';

import { prefetchLifecycleSnapshot } from './journey/useLifecycleSnapshot';
import { lastLensProject } from './lifecycleView/lens/model/lensFocus';

export function prefetchLifecycle(): void {
  import('./LifecyclePage').catch(silentCatch('lifecycle:prefetchChunk'));
  const projectId = lastLensProject();
  if (projectId) prefetchLifecycleSnapshot(projectId);
}
