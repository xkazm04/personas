/** A box as its distances from each edge of a container, in px. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Where `el` sits inside `container`, as insets; `null` when either is missing or has no box. */
export function insetsWithin(el: HTMLElement | null, container: HTMLElement | null): Insets | null {
  if (!el || !container) return null;
  const a = el.getBoundingClientRect();
  const c = container.getBoundingClientRect();
  if (a.width === 0 || c.width === 0) return null;
  return {
    top: Math.max(0, a.top - c.top),
    right: Math.max(0, c.right - a.right),
    bottom: Math.max(0, c.bottom - a.bottom),
    left: Math.max(0, a.left - c.left),
  };
}

/** The CSS `clip-path` that shows only that box. */
export function clipTo(i: Insets): string {
  return `inset(${i.top}px ${i.right}px ${i.bottom}px ${i.left}px)`;
}
