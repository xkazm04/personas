// The rail's glyphs, bp's own (bp src/components/Dock.tsx:48-56), verbatim paths in a 24 x 24 box, drawn in
// currentColor. The View glyph's knobs are filled with the rail's card colour so the rules pass behind them.
export const RAIL_GLYPH = {
  find: <svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M15 15l5 5" stroke="currentColor" strokeWidth="2" /></svg>,
  review: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><circle cx="12" cy="16.6" r="1.1" fill="currentColor" /></svg>,
  agents: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" fill="currentColor" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" stroke="currentColor" strokeWidth="1.8" /></svg>,
  plan: <svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="M3.5 14.5h17M13 14.5v5M8 4.5v10" stroke="currentColor" strokeWidth="1.4" /></svg>,
  view: <svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.5" /><circle cx="9" cy="7" r="2.1" fill="var(--bp-card)" stroke="currentColor" strokeWidth="1.6" /><circle cx="15.5" cy="12" r="2.1" fill="var(--bp-card)" stroke="currentColor" strokeWidth="1.6" /><circle cx="7" cy="17" r="2.1" fill="var(--bp-card)" stroke="currentColor" strokeWidth="1.6" /></svg>,
} as const;
