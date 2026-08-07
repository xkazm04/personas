import { useEffect, useRef } from 'react';
import { useSystemStore } from '@/stores/systemStore';

/**
 * App-wide fleet bootstrap. Renders nothing — it exists ONLY for its effect.
 *
 * **Never mount this behind `import.meta.env.DEV`.** It used to live inside
 * `FleetGridLayer`, whose mount *is* dev-gated (the grid overlay is genuine dev
 * tooling). Rollup then eliminated that branch from production builds and took
 * the bootstrap with it — verifiable in `dist/assets/index-*.js`, where the
 * `FleetGridLayer` lazy def survives only as an unbound expression statement
 * while every neighbouring overlay keeps its `var` binding. The overlay and the
 * bootstrap now live in two files with two mounts so one gate cannot swallow
 * both again; `App.tsx` states the same reason at the gate.
 *
 * None of what follows is dev-only: the Fleet page is reached through Plugins →
 * Dev Tools → Fleet, gated `minTier: TEAM` (`navigation/registry.ts`,
 * `sidebarData.ts`) — a paid tier, not a build flag. When the bootstrap does not
 * run, until the user first opens Fleet / Mastermind / a Passport surface:
 *
 *   • `fleetSlice`'s three lifecycle listeners never attach, so
 *     `FLEET_SESSION_STATE` never patches `fleetSessions[].state`. The
 *     awaiting-input badge in `PluginsSidebarNav` (the Dev Tools plugin row and
 *     the Fleet sub-tab) therefore never lights up. `useFleetCompanionBridge`
 *     is *not* a substitute: it keeps a snapshot loosely fresh for Athena's
 *     episode recording, but a state event it can resolve returns without
 *     refreshing, and Rust emits `FLEET_SESSION_STATE` on its own — no paired
 *     `FLEET_REGISTRY_CHANGED` — so nothing writes the transition into the store.
 *   • `ingestOutboxForCwd` never fires. The memory-outbox → ledger sweep, the
 *     delta context scan, the Obsidian vault projection and the auto deep-scan
 *     dispatch all hang off the session-exited listener and nothing else.
 *   • A `removed` registry event never prunes its stale session row.
 *   • The persisted auto-hibernate / live-slot / state-cutoff policy reaches the
 *     always-on Rust ticker only on first Fleet visit instead of at startup.
 */
export default function FleetBootstrap() {
  const refresh = useSystemStore((s) => s.fleetRefresh);
  const startSessionListeners = useSystemStore((s) => s.fleetStartSessionListeners);

  // Once per app process. `fleetStartSessionListeners` carries its own
  // globalThis-level idempotence guard; this ref is what keeps the paired
  // snapshot refresh from re-firing if the component ever remounts.
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    startSessionListeners();
    void refresh();
  }, [startSessionListeners, refresh]);

  return null;
}
