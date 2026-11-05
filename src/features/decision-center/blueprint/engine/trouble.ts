// PORTED from bp apps/web/src/engine/trouble.ts @ 93f30b0 (spark bp-sync, WP1). Pure: no canvas, no DOM, no React.
// EDIT (port): `Feature` is Personas' (standard/load), whose `trouble` list has the same shape as bp's; `cnt` is
// filled through a local so noUncheckedIndexedAccess reads it. The version source is the caller's: bp passes its sim
// (`healthV`, bumped when live readings re-judge health in place); WP2 names Personas' equivalent. Otherwise verbatim.
// The engine's one index of the features in trouble: overall, per lens (bad and watch members) and the
// per-lens counts the Overview's "Trouble by lens" prints. Flags, the counts and the trouble route (N / Shift+N)
// all read it, so they agree.
//
// Why an index with a version and not a cache keyed by the feature list: live readings re-judge health IN PLACE (the
// same Feature objects get a new `trouble`), so the list's identity never changes while its members do. The index is
// rebuilt when `healthV` has moved since it was built, on the first read after the move (the frame loop reads it
// every draw, and bp's engine publishes the version to the store as `troubleV` so React re-reads the counts).
// Rebuilding costs features x troubles, once per health change, never per frame.
import type { Feature } from '../standard/load';

export interface LensCount { bad: number; watch: number }

export class TroubleIndex {
  private v = NaN;
  private allF: Feature[] = [];
  private byLens = new Map<string, Feature[]>();
  private cnt: Record<string, LensCount> = {};
  private static readonly NONE: readonly Feature[] = [];
  constructor(private readonly features: readonly Feature[], private readonly health: { readonly healthV: number }) {}

  /** The health version the index was last built at (NaN before the first read). */
  get version(): number { return this.v; }

  /** Rebuild if health moved since the last build; true when it rebuilt. */
  sync(): boolean {
    const hv = this.health.healthV;
    if (hv === this.v) return false;
    this.v = hv;
    const all: Feature[] = [], by = new Map<string, Feature[]>(), cnt: Record<string, LensCount> = {};
    for (const f of this.features) {
      if (!f.trouble.length) continue;
      all.push(f);
      for (const t of f.trouble) {
        let l = by.get(t.lens); if (!l) by.set(t.lens, (l = []));
        l.push(f);
        const c = (cnt[t.lens] ??= { bad: 0, watch: 0 });
        c[t.h]++;
      }
    }
    this.allF = all; this.byLens = by; this.cnt = cnt;
    return true;
  }
  /** Every feature with any trouble, in model order. */
  all(): readonly Feature[] { this.sync(); return this.allF; }
  /** The features in trouble (bad or watch) under one lens, in model order. */
  of(lens: string): readonly Feature[] { this.sync(); return this.byLens.get(lens) ?? TroubleIndex.NONE; }
  /** Bad and watch counts per lens id (a lens with none is absent). A new object per rebuild, so it can key a memo. */
  counts(): Readonly<Record<string, LensCount>> { this.sync(); return this.cnt; }
}
