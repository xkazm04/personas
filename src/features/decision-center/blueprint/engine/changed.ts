// The one-shot highlight of changed features. A pure schedule (no canvas, no clock of its own): the engine hands it
// every frame's timestamp, and it says whether a mark is still decaying. While none is, `step` answers false and the
// engine requests no frame for it, so a plan with nothing new is idle. Each flash starts on the first frame that sees
// it (so a frame clock of any origin works) and lasts FLASH_MS.
import type { Engine } from './Engine';
import { featRect } from './plan';
import type { SRect, View } from './view';

/** How long a changed feature stays marked (ms). */
export const FLASH_MS = 2600;

export class Flashes {
  /** fid -> frame time of the first frame it was drawn at (null until then). */
  private at = new Map<string, number | null>();

  add(fids: Iterable<string>): void { for (const f of fids) this.at.set(f, null); }
  clear(): void { this.at.clear(); }
  get size(): number { return this.at.size; }

  /**
   * Advance to frame time `now`; true when this frame must be drawn for the marks: one was showing at the start of it,
   * which includes the frame that takes the last one away (it has to be erased). False when none was: idle.
   */
  step(now: number): boolean {
    if (!this.at.size) return false;
    for (const [f, t] of this.at) {
      if (t === null) this.at.set(f, now);
      else if (now - t >= FLASH_MS) this.at.delete(f);
    }
    return true;
  }

  /** How strong a feature's mark is at `now`, 1 to 0; `still` holds it at full strength for its whole time (reduced motion). */
  strength(fid: string, now: number, still: boolean): number {
    const t = this.at.get(fid);
    if (t === undefined) return 0;
    if (t === null) return 1;
    const left = 1 - (now - t) / FLASH_MS;
    if (left <= 0) return 0;
    return still ? 1 : left * left;
  }

  fids(): IterableIterator<string> { return this.at.keys(); }
}

const sr: SRect = { x: 0, y: 0, w: 0, h: 0 };

/** The changed features, drawn over the plan on the dynamic layer: a faint accent wash and a ring that fade out. */
export function drawChanged(e: Engine, ctx: CanvasRenderingContext2D, v: View, lod: number, now: number): void {
  const fl = e.flashes;
  if (!fl.size) return;
  const th = e.th, still = e.cam.reduced();
  ctx.save();
  for (const fid of fl.fids()) {
    const a = fl.strength(fid, now, still);
    if (a <= 0 || !e.plan.L.TILE[fid]) continue;
    const r = featRect(e, v, fid, lod, sr);
    if (!r) continue;
    ctx.globalAlpha = a * 0.22; ctx.fillStyle = th.accent; ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.globalAlpha = a; ctx.strokeStyle = th.accent; ctx.lineWidth = 2.5; ctx.strokeRect(r.x - 3, r.y - 3, r.w + 6, r.h + 6);
  }
  ctx.restore();
}
