// Content equality for a derived Island.
//
// `deriveScene` is a pure rebuild: every data family that lands (passport phases
// 0/1/2, ship, KPI, relations, scans, monitoring, spend, goals) produces a brand
// new object for EVERY island, even the ones whose cells didn't move. The page's
// island cache therefore can't compare by identity — it has to ask whether the
// CONTENT changed — and it used to answer that with `JSON.stringify(island)`.
//
// That worked, but it is the most expensive way to ask the question: it
// allocates a multi-kilobyte string per island (fifteen dimension nodes plus six
// stats each), it can never bail early on the first difference, and the page
// re-enters that loop once per animation frame while the hydration waves drain.
// On a cold load that is the same N strings built dozens of times over.
//
// These comparisons walk the same fields, short-circuit on the first mismatch,
// and allocate nothing. Field lists are exhaustive against `types.ts` /
// `islandStats.ts` on purpose — a NEW field on Island or DimNode must be added
// here too, or a change in it will be invisible to the cache and the canvas will
// paint stale. That is the one maintenance cost of not using a serializer.
import type { IslandStat } from './islandStats';
import type { DimNode, Island } from './types';

function sameNodes(a: DimNode[], b: DimNode[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (
      x.key !== y.key
      || x.label !== y.label
      || x.status !== y.status
      || x.detail !== y.detail
      || x.reached !== y.reached
      || x.steps !== y.steps
      || x.days !== y.days
      || x.rowKey !== y.rowKey
      || x.action !== y.action
      || x.busy !== y.busy
    ) return false;
  }
  return true;
}

function sameStats(a: IslandStat[], b: IslandStat[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.key !== y.key || x.label !== y.label || x.value !== y.value || x.tone !== y.tone) return false;
  }
  return true;
}

/**
 * True when two islands carry the same content — the cache-hit test for the
 * page's per-island render cache.
 *
 * Deliberately covers the whole shape including the page-decorated fields
 * (`fleet`, `personasRunning`, `attention`, `ship`), so it is a complete answer
 * on its own rather than one half of a comparison whose other half lives at the
 * call site.
 */
export function sameIslandContent(a: Island, b: Island): boolean {
  if (a === b) return true;
  if (
    a.slug !== b.slug
    || a.name !== b.name
    || a.purpose !== b.purpose
    || a.x !== b.x
    || a.y !== b.y
    || a.state !== b.state
    || a.stateSource !== b.stateSource
    || a.autoScore !== b.autoScore
    || a.prodScore !== b.prodScore
    || a.lifecycle !== b.lifecycle
    || a.automationLabel !== b.automationLabel
    || a.blockers !== b.blockers
    || a.attention !== b.attention
    || a.monitorErrors !== b.monitorErrors
  ) return false;
  if (!sameNodes(a.nodes, b.nodes)) return false;
  if (!sameStats(a.stats, b.stats)) return false;
  if (a.fleet.length !== b.fleet.length) return false;
  for (let i = 0; i < a.fleet.length; i++) {
    if (a.fleet[i]!.id !== b.fleet[i]!.id || a.fleet[i]!.state !== b.fleet[i]!.state || a.fleet[i]!.label !== b.fleet[i]!.label) return false;
  }
  if (a.personasRunning.length !== b.personasRunning.length) return false;
  for (let i = 0; i < a.personasRunning.length; i++) {
    if (a.personasRunning[i] !== b.personasRunning[i]) return false;
  }
  if (a.runners.length !== b.runners.length) return false;
  for (let i = 0; i < a.runners.length; i++) {
    const x = a.runners[i]!;
    const y = b.runners[i]!;
    if (x.id !== y.id || x.status !== y.status || x.progress !== y.progress || x.title !== y.title) return false;
  }
  const s = a.ship ?? null;
  const t = b.ship ?? null;
  if (s === null || t === null) return s === t;
  return s.next === t.next && s.shipped === t.shipped && s.total === t.total && s.late === t.late;
}
