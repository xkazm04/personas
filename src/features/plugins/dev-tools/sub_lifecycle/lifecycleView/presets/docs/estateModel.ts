// The doc ESTATE: every judged doc placed in its folder, so where the rot is
// reads at a glance. A folder is a doc's first two directory segments
// ("docs/features", "docs/concepts"; a file at the root is in the root
// folder ""), one segment deeper when two would put every doc in one folder.
// Folders rank worst first (most broken, then stale, then unverifiable docs,
// then size), and inside a folder the docs do too, so a folder's rot leads it.
//
// The filter (status chips + a path search) never moves a doc: the map dims
// what it hides and the list drops it. Pure: no React, no i18n, no IO.
import type { LifecycleDocRow } from '@/lib/bindings/LifecycleDocRow';

import { asDocStatus, DOC_SEVERITY, DOC_STATUSES, groupDocs, type DocGroup, type DocStatus } from '../docsModel';

export type StatusCounts = Record<DocStatus, number>;

export interface DirTile {
  /** "docs/features"; "" for the project root. */
  dir: string;
  /** Worst first, then by path. */
  docs: LifecycleDocRow[];
  counts: StatusCounts;
  /** The worst status in the folder. */
  worst: DocStatus;
}

export interface DocsFilter {
  /** Empty = every status. */
  statuses: ReadonlySet<DocStatus>;
  query: string;
}

export const NO_FILTER: DocsFilter = { statuses: new Set(), query: '' };

export function countByStatus(rows: LifecycleDocRow[]): StatusCounts {
  const counts: StatusCounts = { broken: 0, stale: 0, unverifiable: 0, clean: 0 };
  for (const r of rows) counts[asDocStatus(r.status)] += 1;
  return counts;
}

/** A doc's folder at `depth` directory segments ("" for a root file). */
export function dirKey(path: string, depth: number): string {
  const segments = path.split('/').slice(0, -1);
  return segments.slice(0, depth).join('/');
}

/** Two segments, or three when two would put every doc in one folder and three would not. */
export function estateDepth(rows: LifecycleDocRow[]): number {
  const folders = (depth: number) => new Set(rows.map((r) => dirKey(r.docPath, depth))).size;
  return folders(2) <= 1 && folders(3) > 1 ? 3 : 2;
}

function worstOf(counts: StatusCounts): DocStatus {
  return DOC_STATUSES.find((s) => counts[s] > 0) ?? 'clean';
}

function byWorst(a: LifecycleDocRow, b: LifecycleDocRow): number {
  return DOC_SEVERITY[asDocStatus(b.status)] - DOC_SEVERITY[asDocStatus(a.status)] || a.docPath.localeCompare(b.docPath);
}

/** Compares two folders worst first: broken, stale, unverifiable counts, then size, then name. */
function tileOrder(a: DirTile, b: DirTile): number {
  for (const s of ['broken', 'stale', 'unverifiable'] as const) {
    if (a.counts[s] !== b.counts[s]) return b.counts[s] - a.counts[s];
  }
  return b.docs.length - a.docs.length || a.dir.localeCompare(b.dir);
}

export function buildEstate(rows: LifecycleDocRow[]): DirTile[] {
  const depth = estateDepth(rows);
  const byDir = new Map<string, LifecycleDocRow[]>();
  for (const r of rows) {
    const key = dirKey(r.docPath, depth);
    byDir.set(key, [...(byDir.get(key) ?? []), r]);
  }
  return [...byDir.entries()]
    .map(([dir, docs]) => {
      const counts = countByStatus(docs);
      return { dir, docs: [...docs].sort(byWorst), counts, worst: worstOf(counts) };
    })
    .sort(tileOrder);
}

/**
 * The folder path every non-root folder shares ("docs/"), so a folder card can
 * name only what tells it apart ("features"). Empty when fewer than two
 * folders share one, or when stripping it would leave a folder with no name.
 */
export function sharedDirPrefix(tiles: DirTile[]): string {
  const dirs = tiles.map((t) => t.dir).filter(Boolean).map((d) => d.split('/'));
  if (dirs.length < 2) return '';
  const shared: string[] = [];
  for (let i = 0; dirs.every((d) => d.length > i + 1 && d[i] === dirs[0]![i]); i++) shared.push(dirs[0]![i]!);
  return shared.length > 0 ? `${shared.join('/')}/` : '';
}

/** The search's terms: lower-cased, split on white space. Every term must appear in the path. */
export function queryTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

export function matchesFilter(row: LifecycleDocRow, filter: DocsFilter): boolean {
  if (filter.statuses.size > 0 && !filter.statuses.has(asDocStatus(row.status))) return false;
  const path = row.docPath.toLowerCase();
  return queryTerms(filter.query).every((t) => path.includes(t));
}

export function isFiltering(filter: DocsFilter): boolean {
  return filter.statuses.size > 0 || queryTerms(filter.query).length > 0;
}

/** The resolution list under a filter: the groups worst first, each holding only the docs that pass. */
export function filterGroups(rows: LifecycleDocRow[], filter: DocsFilter): DocGroup[] {
  return groupDocs(rows.filter((r) => matchesFilter(r, filter)));
}

/** One status chip pressed: on when off, off when on. */
export function toggleStatus(statuses: ReadonlySet<DocStatus>, s: DocStatus): Set<DocStatus> {
  const next = new Set(statuses);
  if (next.has(s)) next.delete(s);
  else next.add(s);
  return next;
}
