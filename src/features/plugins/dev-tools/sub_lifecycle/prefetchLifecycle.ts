// Sidebar intent for Projects > Lifecycle: warm the page's chunk and the
// active project's snapshot (into `useLifecycleSnapshot`'s cache) before the
// click lands, so the page opens on data instead of a ghost. The sidebar
// reaches this module through a dynamic import, so none of the page's code
// rides in the main bundle. Both halves are deduped: the chunk is the module
// loader's own promise, and the snapshot skips a copy fetched moments ago and
// joins a request already in flight.
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

import { prefetchLifecycleSnapshot } from './journey/useLifecycleSnapshot';

export function prefetchLifecycle(): void {
  import('./LifecyclePage').catch(silentCatch('lifecycle:prefetchChunk'));
  const projectId = useSystemStore.getState().activeProjectId;
  if (projectId) prefetchLifecycleSnapshot(projectId);
}
