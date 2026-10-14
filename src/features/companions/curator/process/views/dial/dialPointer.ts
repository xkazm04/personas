import { hitTest, type Geo } from './dialGeo';
import type { RepoArc } from './dialModel';

/** What the pointer needs to know, read fresh at the moment it needs it. */
export interface PointerCtx {
  host: HTMLElement;
  geo: () => Geo | null;
  level: () => number;
  repoPicked: () => boolean;
  arcs: () => RepoArc[];
  state: () => { hover: number | null; hoverRepo: number | null; repo: string | null };
  onHover: (q: number | null) => void;
  onHoverRepo: (k: number | null) => void;
  onOpenRing: (q: number) => void;
  onPickRepo: (name: string | null) => void;
}

/**
 * The dial answers the pointer by math, not by elements. Moves are coalesced into one hit-test per
 * animation frame; React hears only when the hovered ring or repository CHANGES, so sweeping the
 * pointer across a hundred ticks costs the same as holding it still.
 */
export function bindPointer(c: PointerCtx): () => void {
  let ptr: { x: number; y: number; chrome: boolean } | null = null;
  let raf = 0;
  let over = false;

  const clear = () => { over = false; c.host.style.cursor = ''; c.onHover(null); c.onHoverRepo(null); };
  const rel = (e: MouseEvent) => {
    const hb = c.host.getBoundingClientRect();
    return { x: e.clientX - hb.left, y: e.clientY - hb.top, chrome: !!(e.target as Element).closest?.('[data-dial-chrome],button,a,input') };
  };
  const tick = () => {
    raf = 0;
    const g = c.geo();
    if (!g || !ptr || c.level() !== 0 || ptr.chrome) { if (over) clear(); return; }
    const h = hitTest(g, c.arcs(), ptr.x, ptr.y);
    const pointable = !!h && (h.t !== 'hub' || c.repoPicked());
    if (pointable !== over) { over = pointable; c.host.style.cursor = over ? 'pointer' : ''; }
    const s = c.state();
    const q = h?.t === 'ring' ? h.q : null;
    const k = h?.t === 'repo' ? h.k : null;
    if (q !== s.hover) c.onHover(q);
    if (k !== s.hoverRepo) c.onHoverRepo(k);
  };
  const onMove = (e: PointerEvent) => { ptr = rel(e); if (!raf) raf = requestAnimationFrame(tick); };
  const onLeave = () => {
    ptr = null;
    const s = c.state();
    if (over || s.hover != null || s.hoverRepo != null) clear();
  };
  const onClick = (e: MouseEvent) => {
    const g = c.geo();
    if (!g || c.level() !== 0) return;
    const p = rel(e);
    if (p.chrome) return;
    const h = hitTest(g, c.arcs(), p.x, p.y);
    const { repo } = c.state();
    if (h?.t === 'ring') c.onOpenRing(h.q);
    else if (h?.t === 'repo') { const nm = c.arcs()[h.k]!.name; c.onPickRepo(repo === nm ? null : nm); }
    else if (h?.t === 'hub' && repo) c.onPickRepo(null);
  };
  c.host.addEventListener('pointermove', onMove);
  c.host.addEventListener('pointerleave', onLeave);
  c.host.addEventListener('click', onClick);
  return () => {
    cancelAnimationFrame(raf);
    c.host.removeEventListener('pointermove', onMove);
    c.host.removeEventListener('pointerleave', onLeave);
    c.host.removeEventListener('click', onClick);
  };
}
