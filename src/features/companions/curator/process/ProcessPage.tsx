import { startTransition, Suspense, useCallback, useMemo, useState, type ComponentType } from 'react';
import { lazyRetry } from '@/lib/lazyRetry';
import { GitCommitVertical } from 'lucide-react';
import { ContentBody, ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { useTranslation } from '@/i18n/useTranslation';
import { buildSpine } from './engine/spine';
import { devFailure, devInstances, type DevMode } from './engine/devAdapter';
import { useProcessData } from './useProcessData';
import { RepoFilter } from './RepoFilter';
import { ProcessGhost } from './ProcessGhost';
import SpineView from './views/SpineView';
import type { ProcessViewId, ProcessViewProps } from './views/types';

const MODES: DevMode[] = ['interactive', 'headless'];
const MODE_TABS = 'process-mode';
const VIEW_TABS = 'process-view';
const VIEWS: ProcessViewId[] = ['spine', 'dial', 'watershed'];

// The two alternatives are figures heavy enough to split: neither costs the Spine a byte until picked.
const VIEW_COMPONENTS: Record<ProcessViewId, ComponentType<ProcessViewProps>> = {
  spine: SpineView,
  dial: lazyRetry(() => import('./views/dial/DialView')),
  watershed: lazyRetry(() => import('./views/watershed/WatershedView')),
};

/**
 * Curator > Process: the strategic layer over the fleet's development sessions.
 *
 * One surface, one job - which phases of the work the sessions reach, and where they fail. The
 * standard path is derived from the sessions themselves. Interactive and headless sessions are
 * different processes and are never pooled; a repository is a filter, measured against its mode.
 */
export default function ProcessPage() {
  const { t, tx } = useTranslation();
  const p = t.companions.process;
  const { reading, loading, error } = useProcessData();
  const [mode, setMode] = useState<DevMode>('interactive');
  const [repoPick, setRepoPick] = useState<string | null>(null);
  const [viewId, setViewId] = useState<ProcessViewId>('spine');
  const View = VIEW_COMPONENTS[viewId];
  // A transition keeps the current view painted while a lazy view's chunk arrives, instead of a blank Suspense beat.
  const pickView = useCallback((v: ProcessViewId) => startTransition(() => setViewId(v)), []);

  const all = useMemo(() => (reading ? devInstances(reading) : []), [reading]);
  const byMode = useMemo(() => MODES.map((m) => all.filter((x) => x.mode === m)), [all]);
  const cohort = useMemo(() => byMode[MODES.indexOf(mode)] ?? [], [byMode, mode]);
  const repos = useMemo(() => {
    const n = new Map<string, number>();
    for (const x of cohort) n.set(x.project, (n.get(x.project) ?? 0) + 1);
    return [...n].map(([name, count]) => ({ name, n: count })).sort((a, b) => b.n - a.n);
  }, [cohort]);
  // A repository with no sessions in this mode is not a filter, it is an empty page.
  const repo = repoPick && repos.some((r) => r.name === repoPick) ? repoPick : null;
  const view = useMemo(() => (repo ? cohort.filter((x) => x.project === repo) : cohort), [cohort, repo]);
  const base = useMemo(() => buildSpine(cohort, devFailure), [cohort]);
  const model = useMemo(() => (repo ? buildSpine(view, devFailure, cohort) : base), [repo, view, cohort, base]);

  const subtitle = reading
    ? repo
      ? tx(p.subtitle_repo, { count: view.length, repo })
      : tx(p.subtitle_all, { count: cohort.length, repos: repos.length })
    : undefined;

  return (
    <ContentBox data-testid="process-page">
      <ContentHeader
        icon={<GitCommitVertical className="h-5 w-5 text-violet-400" />}
        iconColor="violet"
        title={t.companions.nav.page_process}
        subtitle={subtitle}
        fitWidth
        actions={
          <div className="flex items-center gap-3">
            <SegmentedTabs<ProcessViewId>
              tabs={VIEWS.map((v) => ({ id: v, label: p[`view_${v}`], testId: `process-view-${v}` }))}
              activeTab={viewId}
              onTabChange={pickView}
              ariaLabel={p.view_aria}
              idPrefix={VIEW_TABS}
              size="sm"
              fullWidth={false}
            />
            <SegmentedTabs<DevMode>
              tabs={MODES.map((m, i) => ({
                id: m,
                label: `${m === 'interactive' ? p.mode_interactive : p.mode_headless} ${byMode[i]?.length ?? ''}`.trim(),
                testId: `process-mode-${m}`,
              }))}
              activeTab={mode}
              onTabChange={setMode}
              ariaLabel={p.mode_aria}
              idPrefix={MODE_TABS}
              size="sm"
              fullWidth={false}
            />
            <RepoFilter repos={repos} total={cohort.length} value={repo} onChange={setRepoPick} />
          </div>
        }
      />
      <ContentBody>
        {/* The mode strip's panel, declared literally (the census reads the literal). */}
        <div
          role="tabpanel"
          id={`${MODE_TABS}-panel-${mode}`}
          aria-labelledby={`${MODE_TABS}-tab-${mode}`}
          className="h-full w-full"
        >
          <div role="tabpanel" id={`${VIEW_TABS}-panel-${viewId}`} aria-labelledby={`${VIEW_TABS}-tab-${viewId}`} className="h-full w-full">
            {!reading ? (
              <div className="mx-auto w-full max-w-6xl px-2 py-6">
                {error ? <LoadError title={p.error_title} message={error} /> : loading ? <ProcessGhost /> : null}
              </div>
            ) : view.length === 0 ? (
              <p className="py-16 text-center typo-body">{p.empty}</p>
            ) : (
              <Suspense fallback={null}>
                <View reading={reading} mode={mode} repo={repo} cohort={cohort} view={view} model={model} base={base} onRepoChange={setRepoPick} />
              </Suspense>
            )}
          </div>
        </div>
      </ContentBody>
    </ContentBox>
  );
}

function LoadError({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-card border border-status-error/40 bg-status-error/10 p-6" role="alert">
      <p className="typo-heading text-status-error">{title}</p>
      <p className="mt-2 typo-body">{message}</p>
    </div>
  );
}
