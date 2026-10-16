// The legend's one SVG mark (PORTED from bp src/components/Symbols.tsx Mark 'delta'): the changed triangle. The canvas
// draws it inside tiles.ts (deltaMark, not exported), so the key keeps bp's own SVG of it, in the delta token.
export function DeltaMark() {
  return <svg className="lg-sv" width={28} height={19} viewBox="-1 -1 28 19" aria-hidden="true"><path d="M13 2 l8 13 h-16z" fill="var(--bp-delta)" /></svg>;
}
