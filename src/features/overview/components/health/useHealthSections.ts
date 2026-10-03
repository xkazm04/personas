/**
 * Six environments, six independent load cycles (kit batch home-3).
 *
 * `useHealthChecks` ran one `Promise.allSettled` over the six section commands and one
 * `setLoading(false)`, so the fastest section waited on the slowest and all six appeared on the
 * same frame. `docs/design/overview-loading.md` gained **law 6** on 2026-10-03 for exactly that
 * shape: *a region's placeholder is retired by that region's own data, and no region waits on
 * another region's fetch.* This hook is the per-region form -- each section owns its flag, its
 * ghost and its settle, and `runSection` re-runs ONE of them.
 *
 * This is not a speed claim and must never be sold as one (the law's own words): a fan-out over
 * six commands already costs `max(latency)`, not the sum. Splitting the state does not make the
 * panel finish sooner; it makes each environment start showing sooner.
 *
 * Law 1 is kept the way the old hook kept it: `loading` only ever goes false. A re-run (auth
 * change, install completion, a saved key, a registered MCP server) never puts a section back on
 * its ghost, so data on screen is never replaced by a placeholder.
 *
 * A section whose command rejects is `failed`, with no items. The old hook answered a dead IPC
 * bridge with twelve fabricated check items whose `detail` read "Cannot check - IPC unavailable";
 * that is prose standing in for an overview, which is the defect this batch exists to remove, and
 * four of those labels were live `frozen-ui-copy-constant` census sites. A failed section now
 * renders the kit's error band once, and the surfaces read `failed` to hide actions that cannot
 * work without the bridge.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { HealthCheckItem, HealthCheckSection } from '@/api/system/system';
import {
  healthCheckAccount, healthCheckAgents, healthCheckCloud,
  healthCheckEnvironment, healthCheckLocal, healthCheckSubscriptions,
} from '@/api/system/system';
import { silentCatch } from '@/lib/silentCatch';

import { HEALTH_SECTION_IDS, type HealthSectionId } from './healthModel';

export interface HealthSectionState {
  id: HealthSectionId;
  items: HealthCheckItem[];
  /** True until THIS section's own data lands, and never true again (law 1). */
  loading: boolean;
  /** This section's command rejected: the bridge could not answer for it. */
  failed: boolean;
}

const FETCHERS: Record<HealthSectionId, () => Promise<HealthCheckSection>> = {
  local: healthCheckLocal,
  environment: healthCheckEnvironment,
  agents: healthCheckAgents,
  cloud: healthCheckCloud,
  account: healthCheckAccount,
  subscriptions: healthCheckSubscriptions,
};

type Board = Record<HealthSectionId, HealthSectionState>;

function cold(): Board {
  const out = {} as Board;
  for (const id of HEALTH_SECTION_IDS) out[id] = { id, items: [], loading: true, failed: false };
  return out;
}

export interface HealthBoard {
  /** The six sections in reading order, each with its own cycle. */
  sections: HealthSectionState[];
  /** Every check that has landed, across every section. */
  items: HealthCheckItem[];
  /** Re-run ONE section (the detail layer's "Check again"). */
  runSection: (id: HealthSectionId) => void;
  /** Re-run all six, still as six independent cycles. */
  runAll: () => void;
  /** At least one section's command rejected. */
  anyFailed: boolean;
  /** Every section has settled, one way or the other. */
  settled: boolean;
}

export function useHealthSections(): HealthBoard {
  const [board, setBoard] = useState<Board>(cold);
  const gen = useRef<Partial<Record<HealthSectionId, number>>>({});
  const inFlight = useRef<Partial<Record<HealthSectionId, boolean>>>({});

  const runSection = useCallback((id: HealthSectionId) => {
    if (inFlight.current[id]) return;
    inFlight.current[id] = true;
    const mine = (gen.current[id] = (gen.current[id] ?? 0) + 1);
    const fresh = (patch: Partial<HealthSectionState>) => {
      if (gen.current[id] !== mine) return;
      setBoard((prev) => ({ ...prev, [id]: { ...prev[id], ...patch, loading: false } }));
    };
    FETCHERS[id]()
      .then((section) => fresh({ items: section.items, failed: false }))
      .catch((err) => {
        silentCatch(`features/overview/components/health/useHealthSections:${id}`)(err);
        fresh({ failed: true });
      })
      .finally(() => { inFlight.current[id] = false; });
  }, []);

  const runAll = useCallback(() => {
    for (const id of HEALTH_SECTION_IDS) runSection(id);
  }, [runSection]);

  useEffect(() => { runAll(); }, [runAll]);

  const sections = useMemo(() => HEALTH_SECTION_IDS.map((id) => board[id]), [board]);
  const items = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const anyFailed = sections.some((s) => s.failed);
  const settled = sections.every((s) => !s.loading);

  return { sections, items, runSection, runAll, anyFailed, settled };
}
