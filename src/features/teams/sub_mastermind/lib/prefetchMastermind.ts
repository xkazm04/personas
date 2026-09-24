// Prefetch everything the Mastermind canvas waits for, on intent, before the
// page mounts: a browser's preload scanner and <link rel="prefetch">, applied
// to IPC. The canvas holds its verdicts until every verdict-bearing family has
// answered (useSceneSettle); measured 2026-09-24 that took ~1.2-2 s from a
// cold open. Started on a nav hover (and at idle when the Projects section is
// entered), the same fan-out finishes before or shortly after the click, and
// the page paints final verdicts on its first frame.
//
// Everything here writes the same module caches / store families the page
// reads, and every loader dedupes: a prefetch followed by the page's own
// loads costs nothing extra.
import { listCredentials } from '@/api/vault/credentials';
import { cachedPassportSlugs, prefetchPassportData } from '@/features/teams/sub_factory/passport/usePassportData';
import { prefetchFactoryData } from '@/features/teams/sub_factory/factoryData';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

import { useSceneStore } from './sceneStore';
import { loadShipSummaries } from './shipSummaries';

/** A second intent within this window does nothing (hover jitter, re-entry). */
const REPEAT_MS = 20_000;
let lastStartedAt = 0;

export function prefetchMastermind(): void {
  const now = Date.now();
  if (now - lastStartedAt < REPEAT_MS) return;
  lastStartedAt = now;
  void run().catch(silentCatch('mastermind prefetch'));
}

async function run(): Promise<void> {
  const scene = useSceneStore.getState();
  void scene.loadMeta();
  void scene.loadRunners();
  void prefetchFactoryData();

  // Scans, goals and ship summaries are per project: they need the ids the
  // passport build resolves.
  await prefetchPassportData();
  const ids = cachedPassportSlugs().filter((s) => !s.startsWith('demo-'));
  if (ids.length > 0) {
    void scene.loadScans({ projectIds: ids });
    void scene.loadGoals({ projectIds: ids });
    void loadShipSummaries(ids).catch(silentCatch('mastermind prefetch ship'));
  }

  // Monitoring and spend resolve per bound credential. A failed credentials
  // read is NOT "nothing bound": loading these families with an empty list
  // would stamp them loaded-and-empty and their throttle would keep the page
  // from correcting it. Leave them to the page instead.
  const projects = useSystemStore.getState().projects;
  if (projects.length === 0) return;
  let credentials: Awaited<ReturnType<typeof listCredentials>>;
  try {
    credentials = await listCredentials();
  } catch (err) {
    silentCatch('mastermind prefetch credentials')(err);
    return;
  }
  void scene.loadSentry(projects, credentials);
  void scene.loadLlmSpend(projects, credentials);
}
