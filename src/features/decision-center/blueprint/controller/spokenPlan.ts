// PORTED from bp apps/web/src/engine/Engine.ts @ 93f30b0 (spark bp-sync, WP2): saySoon / sayNow, the spoken plan.
// EDIT (port): bp's engine owns the timer and reads its own camera; here a small class takes what it needs as functions
// (how long the camera has been still, the place sentence, the live region's `say`), so the controller wires it to
// the sheet's ONE live region (ui.say, ui/header/ProjLine.tsx) and a test drives it with fake timers. bp says a place
// whenever it rests there; here the same place sentence is never said twice in a row (an arrival in between resets it).
// Speak once the camera has rested REST_MS, so a fly-through or a run of keys says only where it stopped. The text
// replaces what the region said; nothing queues. `next`: the words to say instead of the place's sentence (a trouble-walk
// arrival); undefined keeps a pending one, null drops it.

/** How long the camera must be still before the plan speaks (bp PUSH_MS). */
export const REST_MS = 600;

export interface SpokenDeps {
  /** Milliseconds since the camera last moved; negative while it flies. */
  still(): number;
  /** The sentence for the place in view, or null when the plan does not speak (a page is up over it). */
  place(): string | null;
  say(text: string): void;
}

export class SpokenPlan {
  private next: (() => string) | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private last: string | null = null;
  constructor(private readonly d: SpokenDeps) {}

  saySoon(next?: (() => string) | null): void {
    if (next !== undefined) this.next = next;
    clearTimeout(this.timer);
    this.timer = setTimeout(this.sayNow, REST_MS);
  }

  /** Drop what is pending (the sheet closing). A later saySoon starts afresh. */
  cancel(): void { clearTimeout(this.timer); this.timer = undefined; this.next = null; }

  private sayNow = (): void => {
    const still = this.d.still();
    if (still < REST_MS) { this.timer = setTimeout(this.sayNow, still < 0 ? REST_MS : Math.max(16, REST_MS - still)); return; }
    const f = this.next;
    this.next = null;
    if (f) { const t = f(); if (t) { this.last = null; this.d.say(t); } return; }
    const t = this.d.place();
    if (!t || t === this.last) return;
    this.last = t;
    this.d.say(t);
  };
}
