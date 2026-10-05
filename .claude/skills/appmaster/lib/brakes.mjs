// The brakes as WP1 reads them (context, decide, status): memory headroom, the usage-limit mark and
// the running-builder counts; plus the wake clock (timestamps, the last decided wake, due).
// Read-only: this file never writes the limit mark (WP2's limits.mjs owns it) and never imports
// worker/limits or the DB, so status and context work while those change.

import { GLOBAL_CAP, PER_PROJECT_CAP, limitPath, readJson } from './contract.mjs';
import { memoryState } from './memory.mjs';
import { listRuns, listSlugs } from './store.mjs';

/** The global usage-limit mark; a mark whose resetsAt has passed reads as cleared. */
export function readLimitMark(now = Date.now()) {
  const m = readJson(limitPath(), null);
  if (!m || !m.limitedAt) return { limited: false, reason: null, resetsAt: null };
  if (m.resetsAt && Date.parse(m.resetsAt) <= now) return { limited: false, reason: m.reason ?? null, resetsAt: m.resetsAt, expired: true };
  return { limited: true, reason: m.reason ?? null, resetsAt: m.resetsAt ?? null, limitedAt: m.limitedAt };
}

/** Builders in state `running`, in one project and across every managed project. */
export function runningCounts(slug) {
  const slugs = new Set(listSlugs()); if (slug) slugs.add(slug);
  let global = 0, project = 0;
  for (const s of slugs) {
    const n = listRuns(s, { states: ['running'] }).length;
    global += n; if (s === slug) project = n;
  }
  return { project, global, perProjectCap: PER_PROJECT_CAP, globalCap: GLOBAL_CAP };
}

/** {memory:{usedPct,freeGb,stop}, limit:{limited,resetsAt,...}, running:{project,global}} */
export function brakes(slug) {
  const running = runningCounts(slug);
  return {
    memory: memoryState({ runningBuilders: running.global }),
    limit: readLimitMark(),
    running,
  };
}

// ---------------------------------------------------------------- the wake clock

/** ISO or SQLite 'YYYY-MM-DD HH:MM:SS' (UTC) -> ms, or NaN. */
export function parseTs(s) {
  if (!s) return NaN;
  const t = String(s).trim();
  return Date.parse(/^\d{4}-\d{2}-\d{2} \d/.test(t) ? `${t.replace(' ', 'T')}Z` : t);
}
export function ageText(stamp, nowMs) {
  const t = parseTs(stamp); if (!Number.isFinite(t) || !Number.isFinite(nowMs)) return null;
  const m = Math.round((nowMs - t) / 60000);
  if (m < 0) return `in ${-m} min`;
  if (m < 90) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m ago`;
  return `${Math.floor(h / 24)}d ${h % 24}h ago`;
}

/** The last DECIDED wake (by time), or null. */
export function lastDecided(wakes) {
  return wakes.filter((w) => w.status === 'decided').sort((a, b) => String(a.at).localeCompare(String(b.at))).at(-1) ?? null;
}
/** due = no earlier wake chose a nextWakeAt, or now >= the latest one. */
export function isDue(wakes, nowMs = Date.now()) {
  const next = wakes.map((w) => parseTs(w.nextWakeAt)).filter(Number.isFinite);
  return !next.length || nowMs >= Math.max(...next);
}
