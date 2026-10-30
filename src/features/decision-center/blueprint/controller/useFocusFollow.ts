// Follow bp's shared focus (spark roadmap S6, G4 and G5): while the sheet is open it says hello to bp every 15 s (bp's
// follow chip lists "Personas"), and forgets on close. With Follow on it follows whoever moves (`follow *`), reads the
// shared view once a second through Personas' Rust (FollowSource), and applies each NEW place the bp way (`toApply`:
// never its own write, never a rev it already applied) on the open product: a site, a wing, a bay or a feature
// (model/focusPlace.ts). A place in another product, or an id this plan does not draw, holds the camera still and the
// status line says so. Nothing is ever published (G7 is the owner's decision). bp down = "bp offline", said by Rust's
// 5 s hold, never an error each second.
import { useCallback, useEffect, useRef, useState, type Dispatch } from 'react';
import { silentCatch } from '@/lib/silentCatch';
import { readFocusPlace, toApply, type SharedView } from '../model/focus';
import { placeMove } from '../model/focusPlace';
import type { Plan } from '../model/plan';
import type { FollowSource } from '../source';
import type { UiAction } from '../state/uiState';
import type { BlueprintText } from './useBlueprintText';
import type { Nav } from './useNavigation';

export const FOLLOW_READ_MS = 1_000;
export const FOLLOW_HELLO_MS = 15_000;

export interface FollowState {
  /** The sheet has a follow source (a live product); the fixture has none and shows no chip. */
  available: boolean;
  on: boolean;
  /** Whether bp answered the last read; null before the first read. */
  online: boolean | null;
  /** Who the shared place came from (bp's reader label), once one arrived. */
  from: string | null;
  toggle(): void;
}

const OFF: FollowState = { available: false, on: false, online: null, from: null, toggle: () => {} };

/** bp's SharedView, held to the fields a follower reads; anything else is not a view. */
export function asSharedView(v: unknown): SharedView | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.rev !== 'number' || !Array.isArray(o.readers)) return null;
  if (o.shared === null) return { rev: o.rev, shared: null, readers: [] };
  const sh = o.shared as Record<string, unknown> | undefined;
  if (!sh || typeof sh !== 'object' || typeof sh.reader !== 'string' || typeof sh.label !== 'string' || typeof sh.at !== 'string') return null;
  const place = readFocusPlace(sh.place);
  if (typeof place === 'string') return null;
  // Invariant: surface is bp's own enum; the follower never branches on it, only shows the label.
  return { rev: o.rev, shared: { place, reader: sh.reader, surface: sh.surface as SharedView['readers'][number]['surface'], label: sh.label, at: sh.at }, readers: [] };
}

interface Deps {
  source: FollowSource | undefined;
  projectId: string;
  plan: Plan;
  nav: Nav;
  dispatch: Dispatch<UiAction>;
  text: BlueprintText;
}

export function useFocusFollow({ source, projectId, plan, nav, dispatch, text }: Deps): FollowState {
  const [on, setOn] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  const applied = useRef(0);
  const slug = useRef<string | null | undefined>(undefined);
  const latest = useRef({ plan, nav, dispatch, text, projectId });
  latest.current = { plan, nav, dispatch, text, projectId };

  // presence: hello now and every 15 s while the sheet is open; forget on close
  useEffect(() => {
    if (!source) return;
    const hello = () => { source.move('hello').catch(silentCatch('blueprint:bp-hello')); };
    hello();
    const t = setInterval(hello, FOLLOW_HELLO_MS);
    return () => { clearInterval(t); source.move('forget').catch(silentCatch('blueprint:bp-forget')); };
  }, [source]);

  /** bp's slug for the open product, looked up by root (never guessed from the folder name). */
  const slugOf = useCallback(async (): Promise<string | null> => {
    if (slug.current !== undefined || !source) return slug.current ?? null;
    const rows = await source.products();
    slug.current = rows.find((r) => r.projectId === latest.current.projectId)?.slug ?? null;
    return slug.current;
  }, [source]);

  const apply = useCallback(async (view: SharedView) => {
    if (!source) return;
    const place = toApply(view, source.reader, '*', applied.current);
    if (!place) return;
    applied.current = view.rev;
    const { plan: P, nav: N, dispatch: D, text: { B, tx } } = latest.current;
    const say = (t: string) => D({ type: 'say', text: t });
    const mine = await slugOf();
    if (place.product !== mine) { say(tx(B.follow_elsewhere, { product: place.product })); return; }
    const m = placeMove(place, P);
    if (m.kind === 'site') N.toLevel(0);
    else if (m.kind === 'wing' || m.kind === 'bay') N.flyToPlace(m.kind, m.id);
    else if (m.kind === 'feature') N.openSheet(m.fid, m.lens);
    else { say(tx(B.follow_missing, { kind: m.what, id: m.id })); return; }
    if (place.say) say(place.say);
  }, [source, slugOf]);

  // following: one read a second; Rust holds an offline answer for 5 s, so bp down costs nothing here. bp coming back
  // (or starting after the sheet) hears `follow` again, so its record lists Personas as a follower.
  useEffect(() => {
    if (!source || !on) return;
    let live = true, wasOnline: boolean | null = null;
    const tick = () => {
      source.read().then((r) => {
        if (!live) return;
        if (r.online && wasOnline === false) source.move('follow').catch(silentCatch('blueprint:bp-follow'));
        wasOnline = r.online;
        setOnline(r.online);
        const view = r.online ? asSharedView(r.view) : null;
        if (!view) return;
        setFrom(view.shared?.label ?? null);
        return apply(view);
      }).catch(silentCatch('blueprint:bp-focus-read'));
    };
    tick();
    const t = setInterval(tick, FOLLOW_READ_MS);
    return () => { live = false; clearInterval(t); };
  }, [source, on, apply]);

  const toggle = useCallback(() => {
    if (!source) return;
    const next = !on;
    setOn(next);
    if (next) applied.current = 0; // the place bp holds now is the first one to go to
    source.move(next ? 'follow' : 'unfollow').catch(silentCatch('blueprint:bp-follow'));
  }, [source, on]);

  return source ? { available: true, on, online, from, toggle } : OFF;
}
