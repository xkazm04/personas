/**
 * Overseer > Watched pipelines: every project starred for the Overseer on its
 * Lifecycle page, as a card each (`WatchedPipelineCard`): its steps as a mini
 * rail, his goal's progress and open items, when it was last measured, and
 * the way into its Lifecycle page. Re-reads whenever a lifecycle write lands
 * (`useDevToolsLiveStore().lifecycleRevision`).
 *
 * Rendered whether or not the coaching scope holds any agent: a pipeline is
 * not a persona, and an empty scope says nothing about his pipelines.
 *
 * Loading pattern v2: the section head is permanent chrome; the first read
 * ghosts three cards; a refresh keeps the cards it has; a failure says so
 * inline and keeps any cards already on screen.
 */
import { useCallback, useEffect, useState } from 'react';

import { listOverseerWatchedPipelines } from '@/api/devTools/lifecycle';
import { Banner } from '@/features/shared/components/feedback/Banner';
import { KitHost, Section, Tile, Tiles } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { LifecycleWatchedPipeline } from '@/lib/bindings/LifecycleWatchedPipeline';
import { resolveError } from '@/lib/errors/errorRegistry';
import { extractMessage, silentCatch } from '@/lib/silentCatch';
import { useDevToolsLiveStore } from '@/stores/devToolsLiveStore';
import { useSystemStore } from '@/stores/systemStore';

import { WatchedPipelineCard } from './WatchedPipelineCard';

/** Teams > Lifecycle, scoped to one project (the page acts on the active project). */
function openLifecycle(projectId: string) {
  const sys = useSystemStore.getState();
  void sys.setActiveProject(projectId);
  sys.setSidebarSection('teams');
  sys.setTeamsTab('lifecycle');
}

/** Three abreast from the third card; two halves for two; one card never wider than half. */
const spanFor = (count: number) => (count >= 3 ? 4 : 6);

export function WatchedPipelines() {
  const { t } = useTranslation();
  const d = t.director;
  const revision = useDevToolsLiveStore((s) => s.lifecycleRevision);
  const [rows, setRows] = useState<LifecycleWatchedPipeline[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let alive = true;
    listOverseerWatchedPipelines()
      .then((next) => {
        if (!alive) return;
        setRows(next);
        setError(null);
      })
      .catch((err: unknown) => {
        silentCatch('overseer:watched_pipelines')(err);
        if (alive) setError(resolveError(extractMessage(err)).message);
      });
    return () => {
      alive = false;
    };
  }, [revision, retry]);

  const reload = useCallback(() => setRetry((n) => n + 1), []);
  const count = rows?.length ?? 0;
  const empty = rows !== null && count === 0;

  return (
    <KitHost testId="overseer-watched-pipelines">
      <Section
        title={d.watched_pipelines_title}
        count={rows ? count : undefined}
        desc={d.watched_pipelines_desc}
        state={empty ? 'empty' : undefined}
        empty={{ title: d.watched_pipelines_empty, hint: d.watched_pipelines_empty_hint, testId: 'watched-pipelines-empty' }}
      >
        {error && <Banner severity="error" compact message={error} onRetry={reload} />}
        {rows === null && !error && (
          <Tiles label={d.watched_pipelines_title}>
            {[0, 1, 2].map((i) => <Tile key={i} span={4} state="loading" ghostRows={3} />)}
          </Tiles>
        )}
        {rows !== null && count > 0 && (
          <Tiles label={d.watched_pipelines_title}>
            {rows.map((p) => <WatchedPipelineCard key={p.projectId} pipeline={p} span={spanFor(count)} onOpen={openLifecycle} />)}
          </Tiles>
        )}
      </Section>
    </KitHost>
  );
}
