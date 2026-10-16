// The Persona Monitor's ONE schedule read (WP11): `list_cron_agents`, which
// until now only the Schedules overlay made, so a persona line can print its
// next start. Mounted ONCE by the panel that draws the lines (`ClassicPanel`),
// never per line: on mount, every 30 s while the window is visible, and when
// the scheduler fires overdue triggers. It writes the shared
// `overviewStore.cronAgents` slice (the overlay and the title-bar tray read
// the same one), quietly: a failed background read is logged, not toasted.
//
// A line reads its next start through `useNextStartMs`, a selector that
// returns a NUMBER, so a refresh that changes nothing re-renders nothing.

import { useEffect } from 'react';
import type { CronAgent } from '@/lib/bindings/CronAgent';
import { EventName, typedListen } from '@/lib/eventRegistry';
import { silentCatch } from '@/lib/silentCatch';
import { useOverviewStore } from '@/stores/overviewStore';

const POLL_MS = 30_000;

/** Refreshes the cron agents while the Monitor is open. Call it once. */
export function useMonitorSchedules(): void {
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      if (!cancelled && !document.hidden) void useOverviewStore.getState().fetchCronAgents({ quiet: true });
    };
    refresh();
    const id = window.setInterval(refresh, POLL_MS);
    document.addEventListener('visibilitychange', refresh);
    const unlisten = typedListen(EventName.OVERDUE_TRIGGERS_FIRED, refresh);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', refresh);
      unlisten.then((fn) => fn()).catch(silentCatch('fleet/useMonitorSchedules:unlisten'));
    };
  }, []);
}

/** Per list identity: each persona's upcoming starts, ascending. Built once per refresh. */
const index = new WeakMap<CronAgent[], Map<string, number[]>>();

function startsByPersona(agents: CronAgent[]): Map<string, number[]> {
  let map = index.get(agents);
  if (map) return map;
  map = new Map();
  for (const a of agents) {
    // A switched-off trigger or persona will not start: absent, not "next".
    if (!a.trigger_enabled || !a.persona_enabled || !a.next_trigger_at) continue;
    const ms = Date.parse(a.next_trigger_at);
    if (!Number.isFinite(ms)) continue;
    const list = map.get(a.persona_id) ?? [];
    list.push(ms);
    map.set(a.persona_id, list);
  }
  for (const list of map.values()) list.sort((x, y) => x - y);
  index.set(agents, map);
  return map;
}

/** The persona's next scheduled start after `now`, or null when none is known. */
export function nextStartMs(agents: CronAgent[], personaId: string, now: number): number | null {
  return startsByPersona(agents).get(personaId)?.find((ms) => ms > now) ?? null;
}

/** A line's next start; `null` for no persona (a peer's line) or no schedule. */
export function useNextStartMs(personaId: string | null, now: number): number | null {
  return useOverviewStore((s) => (personaId ? nextStartMs(s.cronAgents, personaId, now) : null));
}
