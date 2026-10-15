// Find: wings (by name or letter), bays (by name or code), features (by name or slug) and queued work (by title).
// Pure, so the match rules are tested without a DOM. The dialog turns a hit into words.
import type { Stage } from '../standard/types';
import type { Plan } from './plan';
import type { Work } from './work';
import { isQueued } from './work';

export type Hit =
  | { kind: 'wing'; id: string; title: string; letter: string; features: number; waiting: number }
  | { kind: 'bay'; id: string; title: string; code: string; room: string }
  | { kind: 'feature'; id: string; title: string; stage: Stage | null; room: string }
  | { kind: 'item'; id: string; title: string; lens: string; feature: string };

export const MAX_HITS = 30;

/** Case- and accent-folded text, so "cafe" finds "Café" and a Turkish capital I folds in its own language. */
const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
const has = (text: string, folded: string): boolean => fold(text).includes(folded);

export function findHits(plan: Plan, work: Work, query: string): Hit[] {
  const q = fold(query.trim());
  const out: Hit[] = [];
  const L = plan.L;
  for (const W of L.wings) {
    if (q && !has(W.def.name, q) && fold(W.def.letter) !== q) continue;
    const waiting = work.items.filter((p) => p.status === 'proposed' && W.feats.includes(p.f)).length;
    out.push({ kind: 'wing', id: W.id, title: W.def.name, letter: W.def.letter, features: W.feats.length, waiting });
  }
  if (!q) return out.slice(0, MAX_HITS);
  for (const B of L.bays) {
    if (has(B.cap.name, q) || has(B.cap.code, q)) out.push({ kind: 'bay', id: B.id, title: B.cap.name, code: B.cap.code, room: B.room.d.name });
  }
  for (const f of plan.S.features) {
    if (has(f.name, q) || f.id.includes(q)) out.push({ kind: 'feature', id: f.id, title: f.name, stage: f.stage, room: L.TILE[f.id]?.room.d.name ?? '' });
  }
  for (const p of work.items) {
    if (isQueued(p) && has(p.title, q)) out.push({ kind: 'item', id: p.id, title: p.title, lens: p.lens, feature: p.f.name });
  }
  return out.slice(0, MAX_HITS);
}
