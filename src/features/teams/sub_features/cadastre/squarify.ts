// The winner's squarified treemap (Bruls, Huizing and van Wijk): items laid
// out in rows along the shorter side, a row closed as soon as adding the next
// item would worsen its worst aspect ratio. Ported as written.
export interface Rect { x: number; y: number; w: number; h: number }

export function squarify<T extends { v: number }>(items: T[], x: number, y: number, w: number, h: number): (T & Rect)[] {
  const total = items.reduce((a, b) => a + b.v, 0);
  const k = (w * h) / total;
  const nodes = items.map((it) => ({ it, a: it.v * k }));
  const out: (T & Rect)[] = [];
  let R: Rect = { x, y, w, h };
  let row: typeof nodes = [];
  const worst = (rw: typeof nodes, side: number) => {
    const s = rw.reduce((a, b) => a + b.a, 0);
    let mx = 0;
    let mn = Infinity;
    for (const r of rw) { mx = Math.max(mx, r.a); mn = Math.min(mn, r.a); }
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  const lay = (rw: typeof nodes) => {
    const s = rw.reduce((a, b) => a + b.a, 0);
    if (R.w >= R.h) {
      const cw = s / R.h;
      let cy = R.y;
      for (const r of rw) { const ch = r.a / cw; out.push({ ...r.it, x: R.x, y: cy, w: cw, h: ch }); cy += ch; }
      R = { x: R.x + cw, y: R.y, w: R.w - cw, h: R.h };
    } else {
      const ch = s / R.w;
      let cx = R.x;
      for (const r of rw) { const cw = r.a / ch; out.push({ ...r.it, x: cx, y: R.y, w: cw, h: ch }); cx += cw; }
      R = { x: R.x, y: R.y + ch, w: R.w, h: R.h - ch };
    }
  };
  let i = 0;
  while (i < nodes.length) {
    const side = Math.min(R.w, R.h);
    const n = nodes[i]!;
    if (row.length === 0 || worst([...row, n], side) <= worst(row, side)) { row.push(n); i += 1; }
    else { lay(row); row = []; }
  }
  if (row.length) lay(row);
  return out;
}
