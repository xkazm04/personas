/**
 * Overseer > Watched pipelines: every project starred for the Overseer on its
 * Lifecycle page, with its goal progress and last measure. Re-reads whenever a
 * lifecycle write lands (`useDevToolsLiveStore().lifecycleRevision`). A row
 * opens that project's Lifecycle page.
 *
 * Loading pattern v2: the section head is permanent chrome; the first read
 * ghosts the rows; a refresh keeps the rows it has; a failure says so inline
 * and keeps any rows already on screen.
 */
import { useCallback, useEffect, useState } from 'react';

import { listOverseerWatchedPipelines } from '@/api/devTools/lifecycle';
import { Banner } from '@/features/shared/components/feedback/Banner';
import { KitHost, Rows, Section } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { LifecycleWatchedPipeline } from '@/lib/bindings/LifecycleWatchedPipeline';
import { resolveError } from '@/lib/errors/errorRegistry';
import { extractMessage, silentCatch } from '@/lib/silentCatch';
import { useDevToolsLiveStore } from '@/stores/devToolsLiveStore';
import { useSystemStore } from '@/stores/systemStore';

import { WatchedPipelineRow } from './WatchedPipelineRow';

/** Teams > Lifecycle, scoped to one project (the page acts on the active project). */
function openLifecycle(projectId: string) {
  const sys = useSystemStore.getState();
  void sys.setActiveProject(projectId);
  sys.setSidebarSection('teams');
  sys.setTeamsTab('lifecycle');
}

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

  return (
    <KitHost testId="overseer-watched-pipelines">
      <Section
        title={d.watched_pipelines_title}
        count={rows ? count : undefined}
        desc={d.watched_pipelines_desc}
      >
        {error && <Banner severity="error" compact message={error} onRetry={reload} />}
        {!(error && rows === null) && (
          <Rows
            loading={rows === null}
            count={count}
            empty={{ title: d.watched_pipelines_empty, hint: d.watched_pipelines_empty_hint, testId: 'watched-pipelines-empty' }}
          >
            {rows?.map((p) => <WatchedPipelineRow key={p.projectId} pipeline={p} onOpen={openLifecycle} />)}
          </Rows>
        )}
      </Section>
    </KitHost>
  );
}
