import { Suspense, useCallback, useEffect, useState } from 'react';
import { toastCatch } from '@/lib/silentCatch';
import { webbuildListProjects } from '@/api/webbuild';
import type { DevProject } from '@/lib/bindings/DevProject';
import StudioTabBar from './StudioTabBar';
import { RouteChunkSkeleton } from '@/features/shared/components/layout/RouteChunkSkeleton';
import { lazyRetry } from '@/lib/lazyRetry';
import { useStudioStore } from './studioStore';
import { useStudioHistory } from './studioHistory';

// Guide is its own chunk, so the tab strip paints before its code arrives.
const GuideStudio = lazyRetry(() => import('./guide/GuideStudio'));

// Dev-only experimental surface: Athena web-dev companion. Projects run as
// browser-style tabs; all build runtime lives in studioStore so a project keeps
// building while you're on another tab or another app module.
// The layout is Guide (docs/design/studio-guide.md); the Classic layout it
// replaced was removed 2026-10-06.
export default function StudioPage() {
  const [projects, setProjects] = useState<DevProject[]>([]);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const initStream = useStudioStore((s) => s.initStream);
  const createWithVision = useStudioStore((s) => s.createWithVision);
  const tabCount = useStudioStore((s) => s.tabOrder.length);
  const hasDraft = useStudioStore((s) => s.draft !== null);

  const refreshProjects = useCallback(async () => {
    try {
      const list = await webbuildListProjects();
      setProjects(list);
      // The one place in Studio holding the authoritative project list, so the
      // one place that can reap persisted history for projects that are gone.
      useStudioHistory.getState().prune(list.map((p) => p.id));
    } catch (e) {
      toastCatch('load projects')(e);
    }
  }, []);

  useEffect(() => {
    initStream();
    void refreshProjects();
  }, [initStream, refreshProjects]);

  const onCreate = useCallback(
    async (name: string, vision: string) => {
      setSubmitting(true);
      // The vision screen gives way at once: the draft (sketch + setup) takes
      // the stage while the scaffold runs. A failed scaffold brings it back
      // with the reason (lastCreateError).
      setCreating(false);
      try {
        await createWithVision(name, vision);
        if (useStudioStore.getState().lastCreateError !== null) setCreating(true);
        else await refreshProjects();
      } finally {
        setSubmitting(false);
      }
    },
    [createWithVision, refreshProjects],
  );

  const showVision = (creating || tabCount === 0) && !hasDraft;

  return (
    <div className="flex h-full w-full min-w-0 flex-col">
      <StudioTabBar projects={projects} onNew={() => setCreating(true)} />
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
        <Suspense fallback={<RouteChunkSkeleton showActions={false} showSubtitle={false} />}>
          <GuideStudio
            showVision={showVision}
            submitting={submitting}
            onCreate={onCreate}
            onCancelCreate={tabCount > 0 ? () => setCreating(false) : undefined}
          />
        </Suspense>
      </div>
    </div>
  );
}
