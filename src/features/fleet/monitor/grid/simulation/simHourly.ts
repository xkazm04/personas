// simHourly — the simulated fleet's runs-per-hour, for the Board's sparkline.
//
// Same shape as `getPersonaRunsHourly` (`get_persona_runs_hourly`): one row per
// persona, `buckets` oldest first, `hours` long, the last bucket is the current
// UTC hour, and a persona with no run in the window is OMITTED (a consumer
// reads a missing persona as all zeros). Built FROM the cards rather than
// beside them, so the sparkline cannot contradict the tile it sits on:
//
//   • the buckets since UTC midnight sum to the card's `runsToday` — the clock
//     the backend counts `runs_today` by;
//   • a running card has at least one run in the current hour;
//   • an agent that has never run (no recent outcomes) has no row.
//
// The hours before midnight are rolled at roughly the same rate, on a stream of
// their own (`SEED.hourly`), so the window does not fall off a cliff at 00:00.

import type { PersonaHourlyRuns } from '@/lib/bindings/PersonaHourlyRuns';
import type { PersonaCardModel } from '../../monitorModel';
import { chance, int, mulberry32, SEED } from './simRandom';

/** The Board's window, and the backend's default. */
export const SIM_HOURLY_WINDOW = 24;
/** The backend clamps the window to one week; so does the simulation. */
const MAX_HOURS = 168;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Runs per UTC hour for each simulated card, ending with the hour `now` falls
 * in. `now` is a parameter for the same reason it is in `buildSimCards`: a test
 * can hold the clock still, and two calls at one instant are the same rows.
 */
export function simHourlyRuns(
  cards: readonly PersonaCardModel[],
  now: number = Date.now(),
  hours: number = SIM_HOURLY_WINDOW,
): PersonaHourlyRuns[] {
  const len = Math.min(MAX_HOURS, Math.max(1, Math.floor(hours)));
  const rand = mulberry32(SEED.hourly);
  // Hours elapsed today (UTC), the current one included, capped by the window.
  const todayHours = Math.min(len, Math.floor((now % DAY_MS) / HOUR_MS) + 1);
  const firstToday = len - todayHours;
  const out: PersonaHourlyRuns[] = [];
  for (const card of cards) {
    if (card.recentStatuses.length === 0) continue;
    const buckets = new Array<number>(len).fill(0);
    const add = (i: number) => { buckets[i] = (buckets[i] ?? 0) + 1; };
    let left = card.runsToday;
    if (card.running > 0 && left > 0) {
      add(len - 1);
      left -= 1;
    }
    for (; left > 0; left -= 1) add(firstToday + int(rand, 0, todayHours - 1));
    // Before midnight: busy about as often as today, never more than a few.
    const perHour = card.runsToday / todayHours;
    const ceiling = Math.max(1, Math.ceil(perHour * 2));
    for (let i = 0; i < firstToday; i += 1) {
      if (chance(rand, Math.min(0.6, 0.15 + perHour))) buckets[i] = int(rand, 1, ceiling);
    }
    if (buckets.some((n) => n > 0)) out.push({ personaId: card.personaId, buckets });
  }
  return out;
}
