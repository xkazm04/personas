// Ids for canvas objects (groups, links, notes).
//
// The old form was `g${Date.now().toString(36)}` — unique only as long as ONE
// writer creates at most one object per millisecond. Athena composes a whole
// batch in a single tick, and she does it while the user is drawing, so both
// halves of that assumption are gone. Each id now carries a per-process
// sequence AND a random tail: the sequence separates same-millisecond creations
// inside one writer, the random tail separates the two writers from each other.
// Existing ids are untouched — this only shapes new ones.
let seq = 0;

/** `<prefix><base36 ms><base36 seq><random>` — collision-safe across writers. */
export function canvasId(prefix: string): string {
  seq = (seq + 1) % 1_679_616; // 36^4
  const tick = Date.now().toString(36);
  const n = seq.toString(36).padStart(4, '0');
  const rand = Math.random().toString(36).slice(2, 6).padStart(4, '0');
  return `${prefix}${tick}${n}${rand}`;
}
