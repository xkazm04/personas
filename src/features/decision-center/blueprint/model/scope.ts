// What the camera is over, as a scope for the Build queue. At the site the queue holds the whole product; at L1 a
// wing; at L2 a room; at L3 a bay; at L4 one feature. The queue, the "Here" block and the walk (J / K) all read it.
import type { Feature } from '../standard/load';
import type { BayNode, Layout, RoomNode, WingNode } from './layout';
import { isQueued, type Work, type WorkItem } from './work';

export type ScopeKind = 'site' | 'wing' | 'room' | 'bay' | 'feature';
export type Level = 0 | 1 | 2 | 3 | 4;

export interface Scope {
  kind: ScopeKind;
  level: Level;
  /** The place (wing, room, bay) or the feature's id; '' at the site. */
  id: string;
  /** The features inside, or null for the whole product. */
  feats: ReadonlySet<string> | null;
}

export interface ChainIds { wing?: string; room?: string; bay?: string }

const idsOf = (fs: readonly Feature[]) => new Set(fs.map((f) => f.id));

/** The scope for a camera level (0..3) over a chain of place ids, or for an open feature sheet (level 4). */
export function scopeOf(L: Layout, level: Level, chain: ChainIds, sheetFid: string | null): Scope {
  if (sheetFid) return { kind: 'feature', level: 4, id: sheetFid, feats: new Set([sheetFid]) };
  if (level === 0) return { kind: 'site', level, id: '', feats: null };
  if (level === 1) { const W = chain.wing ? L.WING[chain.wing] : undefined; if (W) return { kind: 'wing', level, id: W.id, feats: idsOf(W.feats) }; }
  if (level === 2) { const R = chain.room ? L.ROOM[chain.room] : undefined; if (R) return { kind: 'room', level, id: R.id, feats: idsOf(R.feats) }; }
  if (level === 3) { const B = chain.bay ? L.BAY[chain.bay] : undefined; if (B) return { kind: 'bay', level, id: B.id, feats: idsOf(B.feats) }; }
  return { kind: 'site', level: 0, id: '', feats: null };
}

export const inScope = (s: Scope, p: WorkItem): boolean => !s.feats || s.feats.has(p.fid);

/** The place a scope names, for the title block and the queue. */
export function placeOf(L: Layout, s: Scope): WingNode | RoomNode | BayNode | null {
  if (s.kind === 'wing') return L.WING[s.id] ?? null;
  if (s.kind === 'room') return L.ROOM[s.id] ?? null;
  if (s.kind === 'bay') return L.BAY[s.id] ?? null;
  return null;
}

/** The queue under a scope and a sheet: waiting then approved, in plan order (left to right), then by risk. */
export function queueIn(work: Work, L: Layout, s: Scope, lens: string): WorkItem[] {
  return work.items
    .filter((p) => isQueued(p) && inScope(s, p) && (lens === 'general' || p.lens === lens))
    .sort((a, b) => (L.TILE[a.fid]?.ti ?? 0) - (L.TILE[b.fid]?.ti ?? 0) || (b.risk ?? 0) - (a.risk ?? 0));
}

/** Every waiting (proposed) item the lens sheet shows, plan order: the walk's loop when a scope holds none. */
export function waitingIn(work: Work, L: Layout, lens: string): WorkItem[] {
  return work.items
    .filter((p) => p.status === 'proposed' && (lens === 'general' || p.lens === lens))
    .sort((a, b) => (L.TILE[a.fid]?.ti ?? 0) - (L.TILE[b.fid]?.ti ?? 0));
}
