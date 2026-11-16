/**
 * bpFollower - Personas' ONE follower of bp's shared focus (spark roadmap S6, G4 and G5; bp
 * docs/concepts/one-morning-brief/personas.md section 3.2). One per window, shared by every Blueprint surface: the
 * Monitor's Blueprint and Morning tabs and the drawing sheet. Personas follows and never publishes (G7 is the owner's).
 *
 *   presence   while a Blueprint surface is VISIBLE (registered, shown, and the window not hidden) it says hello now and
 *              every 15 s, so bp's follow chip lists "Personas". Hidden, it stops saying hello and bp lets it go 45 s
 *              later (bp LIVE_MS). When the last surface closes it says forget (after a 1 s grace, so a sheet that
 *              remounts on another product does not blink out of bp's list).
 *   following  with Follow on and a surface visible it reads the shared view once a second through Personas' Rust
 *              (bp down: Rust answers offline at once for 5 s, so this says "offline" every 5 s instead of failing each
 *              second), and takes each NEW place the bp way (`toApply`: never its own write, never a rev it applied).
 *   routing    the place's product slug is looked up in bp's product table by root (`bp_products`), never guessed from a
 *              folder name: the open sheet's product applies it in place; another Personas product opens the sheet AT
 *              the place (`open`); a slug with no Personas project holds still and says "Not in Personas: <slug>".
 *
 * React-free: the timers, the window's visibility and the sheet opener are injected, so tests drive it by hand.
 */
import { readFocusPlace, toApply, type FocusPlace, type SharedView } from '../blueprint/model/focus';
import type { FollowSource } from '../blueprint/source';
import { silentCatch } from '@/lib/silentCatch';

export const FOLLOW_READ_MS = 1_000;
export const FOLLOW_HELLO_MS = 15_000;
/** A surface that closes and another that opens within this long (a product switch) is one presence. */
export const FORGET_GRACE_MS = 1_000;
/** An unknown slug re-reads bp's product table at most this often. */
export const PRODUCTS_STALE_MS = 10_000;

/** What the follower last could not apply, in data (the surfaces word it). */
export type FollowNote =
  | { kind: 'product'; slug: string }
  | { kind: 'missing'; what: string; id: string };

export interface FollowerState {
  on: boolean;
  /** Whether bp answered the last read; null before the first read. */
  online: boolean | null;
  /** Who moved the shared place (bp's reader label), once one arrived. */
  from: string | null;
  /** Something the last place could not do; null when it landed. */
  note: FollowNote | null;
  /** The rev of the last place taken (0 = none yet). */
  rev: number;
  /** Visible Blueprint surfaces right now (presence is on while this is above 0). */
  visible: number;
}

/** The open sheet, applying a place on its own product. Answers what it could not do, or null when it landed. */
export type ApplyHere = (place: FocusPlace) => FollowNote | null;

export interface FollowerDeps {
  /** Open the drawing sheet on another product, at the place. */
  open(projectId: string, place: FocusPlace): void;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (t: unknown) => void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (t: unknown) => void;
  /** Whether the window is shown (document.visibilityState); and a subscription to its changes. */
  windowVisible?: () => boolean;
  onWindowVisibility?: (cb: () => void) => () => void;
}

export interface SurfaceHandle {
  /** The surface is on screen (a Monitor tab while the Monitor is open; a sheet while it is mounted). */
  setVisible(v: boolean): void;
  close(): void;
}

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

export class BpFollower {
  readonly reader: string;
  private state: FollowerState = { on: false, online: null, from: null, note: null, rev: 0, visible: 0 };
  private listeners = new Set<() => void>();
  private surfaces = new Map<symbol, boolean>();
  private here: { projectId: string; apply: ApplyHere } | null = null;
  private helloTimer: unknown = null;
  private readTimer: unknown = null;
  private forgetTimer: unknown = null;
  private present = false;
  private wasOnline: boolean | null = null;
  private table: { at: number; rows: { slug: string; projectId?: string }[] } | null = null;
  private stopWindow: (() => void) | null = null;
  private d: Required<FollowerDeps>;

  constructor(private src: FollowSource, deps: FollowerDeps) {
    this.reader = src.reader;
    this.d = {
      now: () => Date.now(),
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (t) => clearInterval(t as ReturnType<typeof setInterval>),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
      windowVisible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
      onWindowVisibility: (cb) => {
        if (typeof document === 'undefined') return () => {};
        document.addEventListener('visibilitychange', cb);
        return () => document.removeEventListener('visibilitychange', cb);
      },
      ...deps,
    };
  }

  // ---- the store (useSyncExternalStore) ----
  getState = (): FollowerState => this.state;
  subscribe = (l: () => void): (() => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private set(patch: Partial<FollowerState>): void {
    const next = { ...this.state, ...patch };
    if ((Object.keys(patch) as (keyof FollowerState)[]).every((k) => Object.is(next[k], this.state[k]))) return;
    this.state = next;
    for (const l of this.listeners) l();
  }

  // ---- surfaces and presence ----
  /** A Blueprint surface mounts. It counts toward presence while it says it is visible and the window is shown. */
  surface(visible = true): SurfaceHandle {
    const key = Symbol('surface');
    this.surfaces.set(key, visible);
    if (this.forgetTimer !== null) { this.d.clearTimeout(this.forgetTimer); this.forgetTimer = null; }
    if (!this.stopWindow) this.stopWindow = this.d.onWindowVisibility(() => this.sync());
    this.sync();
    return {
      setVisible: (v) => { if (this.surfaces.has(key)) { this.surfaces.set(key, v); this.sync(); } },
      close: () => {
        if (!this.surfaces.delete(key)) return;
        this.sync();
        if (this.surfaces.size === 0) {
          this.forgetTimer = this.d.setTimeout(() => {
            this.forgetTimer = null;
            if (this.surfaces.size) return;
            this.stopWindow?.(); this.stopWindow = null;
            if (this.present) this.src.move('forget').catch(silentCatch('blueprint:bp-forget'));
            this.present = false;
          }, FORGET_GRACE_MS);
        }
      },
    };
  }

  /** The open sheet's product takes places in place; anything else opens the sheet at the place. */
  attach(projectId: string, apply: ApplyHere): () => void {
    const me = { projectId, apply };
    this.here = me;
    return () => { if (this.here === me) this.here = null; };
  }

  private visibleCount(): number {
    if (!this.d.windowVisible()) return 0;
    let n = 0;
    for (const v of this.surfaces.values()) if (v) n++;
    return n;
  }

  /** Start or stop the hello and read loops to match what is on screen. */
  private sync(): void {
    const visible = this.visibleCount();
    this.set({ visible });
    if (visible > 0 && this.helloTimer === null) {
      this.hello();
      this.helloTimer = this.d.setInterval(() => this.hello(), FOLLOW_HELLO_MS);
    } else if (visible === 0 && this.helloTimer !== null) {
      // hidden: no forget, bp lets the reader go LIVE_MS (45 s) after its last hello
      this.d.clearInterval(this.helloTimer);
      this.helloTimer = null;
    }
    const reading = visible > 0 && this.state.on;
    if (reading && this.readTimer === null) {
      this.tick();
      this.readTimer = this.d.setInterval(() => this.tick(), FOLLOW_READ_MS);
    } else if (!reading && this.readTimer !== null) {
      this.d.clearInterval(this.readTimer);
      this.readTimer = null;
    }
  }

  private hello(): void {
    this.present = true;
    this.src.move('hello').catch(silentCatch('blueprint:bp-hello'));
  }

  // ---- following ----
  setOn(on: boolean): void {
    if (on === this.state.on) return;
    // turning Follow on goes to the place bp holds now: nothing counts as applied yet
    this.set(on ? { on, rev: 0, note: null } : { on, online: null, from: null });
    this.wasOnline = null;
    this.src.move(on ? 'follow' : 'unfollow').catch(silentCatch('blueprint:bp-follow'));
    this.sync();
  }
  toggle = (): void => this.setOn(!this.state.on);

  /** One read (exported for tests through the timers). */
  private tick(): void {
    this.src.read().then((r) => {
      if (!this.state.on) return;
      // bp came back (or started after Personas): say follow again, so its record lists Personas as a follower
      if (r.online && this.wasOnline === false) this.src.move('follow').catch(silentCatch('blueprint:bp-follow'));
      this.wasOnline = r.online;
      this.set({ online: r.online });
      const view = r.online ? asSharedView(r.view) : null;
      if (!view) return;
      this.set({ from: view.shared?.label ?? null });
      const place = toApply(view, this.reader, '*', this.state.rev);
      if (!place) return;
      this.set({ rev: view.rev });
      return this.route(place);
    }).catch(silentCatch('blueprint:bp-read'));
  }

  /** bp's slug -> the Personas project at the same root (bp's product table, by root); undefined when Personas has none. */
  async projectOf(slug: string): Promise<string | undefined> {
    const find = () => this.table?.rows.find((r) => r.slug === slug);
    const stale = !this.table || (!find() && this.d.now() - this.table.at > PRODUCTS_STALE_MS);
    if (stale) this.table = { at: this.d.now(), rows: await this.src.products() };
    return find()?.projectId;
  }

  private async route(place: FocusPlace): Promise<void> {
    const projectId = await this.projectOf(place.product);
    if (!projectId) { this.set({ note: { kind: 'product', slug: place.product } }); return; }
    if (this.here && this.here.projectId === projectId) { this.set({ note: this.here.apply(place) }); return; }
    this.set({ note: null });
    this.d.open(projectId, place);
  }

  /** Stop everything (tests; a window closing). */
  dispose(): void {
    for (const t of [this.helloTimer, this.readTimer]) if (t !== null) this.d.clearInterval(t);
    if (this.forgetTimer !== null) this.d.clearTimeout(this.forgetTimer);
    this.helloTimer = this.readTimer = this.forgetTimer = null;
    this.stopWindow?.(); this.stopWindow = null;
    this.surfaces.clear();
    this.listeners.clear();
  }
}
