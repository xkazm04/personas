import { Suspense, useCallback, useEffect, useState } from 'react';
import { toastCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import { guideStrings } from './guide/guideCopy';
import { webbuildListProjects } from '@/api/webbuild';
import type { DevProject } from '@/lib/bindings/DevProject';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import StudioTabBar from './StudioTabBar';
import { RouteChunkSkeleton } from '@/features/shared/components/layout/RouteChunkSkeleton';
import { lazyRetry } from '@/lib/lazyRetry';
import { useStudioStore } from './studioStore';
import { useStudioHistory, type StudioLayout } from './studioHistory';

// Each layout is its own chunk: opening Guide never downloads Classic, and
// the tab strip + switch paint before either layout's code has arrived.
const GuideStudio = lazyRetry(() => import('./guide/GuideStudio'));
const StudioCurrentLayout = lazyRetry(() => import('./StudioCurrentLayout'));

// Dev-only experimental surface: Athena web-dev companion. Projects run as
// browser-style tabs; all build runtime lives in studioStore so a project keeps
// building while you're on another tab or another app module.
//
// TODO(prototype, 2026-09-23): Studio renders one of two layouts behind this
// switch, the current one or Guide (the /prototype winner). Guide replaces the
// current layout once it reaches parity; see docs/design/studio-guide.md.
export default function StudioPage() {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<DevProject[]>([]);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const initStream = useStudioStore((s) => s.initStream);
  const createWithVision = useStudioStore((s) => s.createWithVision);
  const tabCount = useStudioStore((s) => s.tabOrder.length);
  const hasDraft = useStudioStore((s) => s.draft !== null);
  const layout = useStudioHistory((s) => s.layout);
  const setLayout = useStudioHistory((s) => s.setLayout);

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
        if (useStudioStore.getState().lastCreateError) setCreating(true);
        else await refreshProjects();
      } finally {
        setSubmitting(false);
      }
    },
    [createWithVision, refreshProjects],
  );

  const showVision = (creating || tabCount === 0) && !hasDraft;
  const layoutTabs: { id: StudioLayout; label: string }[] = [
    { id: 'guide', label: guideStrings(t).layout_guide },
    { id: 'current', label: guideStrings(t).layout_current },
  ];

  return (
    <div className="flex h-full w-full min-w-0 flex-col">
      <div className="flex min-w-0 shrink-0 items-center border-b border-border">
        <div className="min-w-0 flex-1 [&>header]:border-b-0">
          <StudioTabBar projects={projects} onNew={() => setCreating(true)} />
        </div>
        <SegmentedTabs
          tabs={layoutTabs}
          activeTab={layout}
          onTabChange={setLayout}
          size="sm"
          ariaLabel={guideStrings(t).layout_switch}
          layoutId="studio-layout-switch"
          idPrefix="studio-layout"
          className="mr-3 shrink-0"
        />
      </div>
      <div
        role="tabpanel"
        id={`studio-layout-panel-${layout}`}
        aria-labelledby={`studio-layout-tab-${layout}`}
        className="flex min-h-0 w-full min-w-0 flex-1 flex-col"
      >
        <Suspense fallback={<RouteChunkSkeleton showActions={false} showSubtitle={false} />}>
          {layout === 'guide' ? (
            <GuideStudio
              showVision={showVision}
              submitting={submitting}
              onCreate={onCreate}
              onCancelCreate={tabCount > 0 ? () => setCreating(false) : undefined}
            />
          ) : (
            <StudioCurrentLayout
              showVision={creating || tabCount === 0}
              submitting={submitting}
              onCreate={onCreate}
            />
          )}
        </Suspense>
      </div>
    </div>
  );
}
