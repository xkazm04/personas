/**
 * Focus without React: hovering a settlement or a plate marks its station's marks, leader and
 * plate with `data-on` and dims the rest of the map (`data-dim`). These are a few dozen elements
 * and the work runs only when the focused station CHANGES, never per pointer frame, so the map's
 * React tree is untouched by hover.
 */
export function paintFocus(root: HTMLElement, hover: number | null, station: number | null): void {
  const f = hover ?? station;
  const svg = root.querySelector('.ws-map');
  if (svg) svg.toggleAttribute('data-dim', f != null);
  root.querySelectorAll<HTMLElement | SVGElement>('.ws-st').forEach((el) => el.toggleAttribute('data-on', f != null && Number(el.dataset.q) === f));
  root.querySelectorAll<HTMLElement | SVGElement>('.ws-leader, .ws-plate').forEach((el) => el.toggleAttribute('data-on', hover != null && Number(el.dataset.q) === hover));
}

/**
 * The region title behind the map names the focused station, or the mode when nothing is focused.
 * It fades out, swaps and fades back (opacity only); a newer focus cancels a pending swap.
 */
export function regionTitle(el: SVGTextElement | null, text: string, named: boolean, reduce: boolean, prev: { timer: number }): void {
  if (!el) return;
  window.clearTimeout(prev.timer);
  if (el.textContent === text) { el.classList.toggle('is-named', named); el.style.opacity = ''; return; }
  el.style.opacity = '0';
  prev.timer = window.setTimeout(() => {
    el.textContent = text;
    el.classList.toggle('is-named', named);
    el.style.opacity = '';
  }, reduce ? 0 : 140);
}

/** Which settlement the point (in map coordinates) is over, by distance; null when none. */
export function hitSettlement(xs: number[], yAt: (x: number) => number, r: number, px: number, py: number): number | null {
  for (let q = 0; q < xs.length; q++) {
    const x = xs[q]!;
    if (Math.abs(px - x) <= r && Math.abs(py - yAt(x)) <= r) return q;
  }
  return null;
}
