// The change maps of the compare panel's shot pairs (PORTED from bp train/compare/useChangeMap.ts): each pair is
// computed once per session (the shared createModuleCache, keyed by product and the two shot ids, bounded) by changeMap.worker.ts, so walking
// items back and forth never recomputes and the main thread does no pixel work. Where Worker or OffscreenCanvas is
// missing, or the worker cannot start, the pair is computed on the main thread instead. A failed pair is not cached:
// its URL may have been revoked under it (a theme switch), and the next ask computes it again.
import { useEffect, useSyncExternalStore } from 'react';
import { createModuleCache } from '@/hooks/utility/data/useModuleSubscription';
import { silentCatch } from '@/lib/silentCatch';
import { diffPixels, type PixGrid } from '../../model/ledgerPixels';
import type { MapReply, MapRequest } from './changeMap.worker';
import { extractMessage } from '@/lib/silentCatch';

/** A shot pair to compare: its cache key and the two image URLs. */
export interface PairRef { key: string; before: string; after: string }
export type MapState = { status: 'computing' } | { status: 'done'; grid: PixGrid } | { status: 'error'; error: string };

const MAX_W = 1600;
/** Pairs held per session: a panel shows at most a few, walking items adds a handful each. */
const MAX_PAIRS = 200;
const maps = createModuleCache<string, MapState>({ maxSize: MAX_PAIRS });
let version = 0;
const sub = (f: () => void) => maps.subscribe(f);
const snap = () => version;
function put(key: string, st: MapState) { maps.set(key, st); version++; maps.notify(); }

/** undefined: not tried yet; null: unavailable here (the main thread computes). */
let worker: Worker | null | undefined;
const waiting = new Map<number, (r: MapReply | null) => void>();
let seq = 0;

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return (worker = null);
  try {
    const w = new Worker(new URL('./changeMap.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<MapReply>) => { const f = waiting.get(e.data.id); waiting.delete(e.data.id); f?.(e.data); };
    // a worker that cannot load or crashes: every pending pair falls back to the main thread, and so do later ones
    w.onerror = () => { worker = null; w.terminate(); for (const f of waiting.values()) f(null); waiting.clear(); };
    worker = w;
  } catch (e) {
    silentCatch('decisionCenter.blueprint.changeMap:worker')(e);
    worker = null;
  }
  return worker;
}

function ask(w: Worker, before: MapRequest['before'], after: MapRequest['after']): Promise<MapReply | null> {
  const id = ++seq, transfer = [before, after].filter((x): x is ImageBitmap => typeof x !== 'string');
  return new Promise((res) => { waiting.set(id, res); w.postMessage({ id, before, after } satisfies MapRequest, transfer); });
}

async function loadImg(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  await img.decode();
  return img;
}

/** The fallback: both images drawn on a canvas and compared here. */
async function onMain(p: PairRef): Promise<PixGrid> {
  const [a, b] = await Promise.all([loadImg(p.before), loadImg(p.after)]);
  const k = Math.min(1, MAX_W / Math.max(1, a.naturalWidth)), w = Math.max(1, Math.round(a.naturalWidth * k)), h = Math.max(1, Math.round(a.naturalHeight * k));
  const read = (img: HTMLImageElement) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) throw new Error('no 2d canvas context');
    g.drawImage(img, 0, 0, w, h);
    return g.getImageData(0, 0, w, h).data;
  };
  return diffPixels(read(a), read(b), w, h);
}

async function compute(p: PairRef): Promise<PixGrid> {
  const w = getWorker();
  if (!w) return onMain(p);
  let r = await ask(w, p.before, p.after);
  // an SVG cannot be decoded in a worker: the page decodes, the worker still compares
  if (r && 'error' in r && r.decode) {
    const [a, b] = await Promise.all([loadImg(p.before), loadImg(p.after)]);
    r = await ask(w, await createImageBitmap(a), await createImageBitmap(b));
  }
  if (!r) return onMain(p);
  if ('grid' in r) return r.grid;
  throw new Error(r.error);
}

function start(p: PairRef) {
  const st = maps.get(p.key);
  if (st && st.status !== 'error') return;
  put(p.key, { status: 'computing' });
  compute(p).then((grid) => put(p.key, { status: 'done', grid }), (e: unknown) => put(p.key, { status: 'error', error: extractMessage(e) }));
}

/** The change map of each pair, in order: undefined until its computation starts, then computing, done or error.
 *  Pass a memoised array. */
export function useChangeMap(pairs: readonly PairRef[]): readonly (MapState | undefined)[] {
  useSyncExternalStore(sub, snap, snap);
  useEffect(() => { for (const p of pairs) start(p); }, [pairs]);
  return pairs.map((p) => maps.get(p.key));
}
