import { useSyncExternalStore } from 'react';
import type { Translations } from '@/i18n/generated/types';
import { interpolate } from '@/i18n/useTranslation';

// ONE shared 30s ticker for every ago-label in the fleet (optimizer pass).
// The previous per-component setInterval meant N cards + N tiles + the banner
// each owned a timer, re-rendering on their own phase — a constant background
// drizzle. The shared store starts its single interval on the first subscriber,
// stops on the last, and notifies everyone in one aligned batch.
const TICK_MS = 30_000;
let tickNow = Date.now();
let tickTimer: ReturnType<typeof setInterval> | null = null;
const tickListeners = new Set<() => void>();

function subscribeTick(listener: () => void): () => void {
  tickListeners.add(listener);
  if (tickTimer === null) {
    tickNow = Date.now(); // fresh epoch when waking from idle
    tickTimer = setInterval(() => {
      tickNow = Date.now();
      for (const l of tickListeners) l();
    }, TICK_MS);
  }
  return () => {
    tickListeners.delete(listener);
    if (tickListeners.size === 0 && tickTimer !== null) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };
}

const getTickNow = () => tickNow;

/**
 * A `now` timestamp that re-renders the caller on a shared 30s cadence, so
 * relative "Xs ago" labels stay fresh without each row owning its own timer —
 * fine-grained enough for "how long has this been waiting?" without churning
 * the grid.
 */
export function useNowTick(): number {
  return useSyncExternalStore(subscribeTick, getTickNow, getTickNow);
}

/**
 * Urgency tier for a session blocked on the operator. The oldest waiting
 * session is the costliest one — these tiers drive escalating accents in
 * the "Needs you" banner so it pops without any per-second ticking.
 */
export type WaitTier = 'fresh' | 'aging' | 'stuck';

export function waitTier(waitedMs: number): WaitTier {
  const m = waitedMs / 60_000;
  if (m < 5) return 'fresh';
  if (m < 15) return 'aging';
  return 'stuck';
}

/** Compact relative-time label ("just now" / "5s ago" / "3m ago" / "2h ago"). */
export function formatAgo(t: Translations, fromMs: number, now: number): string {
  const s = Math.max(0, Math.floor((now - fromMs) / 1000));
  if (s < 10) return t.plugins.fleet.ago_just_now;
  if (s < 60) return interpolate(t.plugins.fleet.ago_seconds, { n: s });
  const m = Math.floor(s / 60);
  if (m < 60) return interpolate(t.plugins.fleet.ago_minutes, { n: m });
  const h = Math.floor(m / 60);
  return interpolate(t.plugins.fleet.ago_hours, { n: h });
}
