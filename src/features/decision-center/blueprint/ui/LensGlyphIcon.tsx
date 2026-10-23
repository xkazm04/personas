import type { GlyphSpec } from '../engine/glyphs';

// The lens glyphs as SVG strokes in a 16x16 box: the same shapes engine/glyphs.ts draws on the canvas, for the
// chrome (sheet tabs, queue rows, cards). Colour is `currentColor`; a custom manifest path is stroked as is.
const SHAPES: Record<string, React.ReactNode> = {
  bars: <path d="M1 9.3h3.8V16H1zM6.1 4.8h3.8V16H6.1zM11.2 0h3.8v16h-3.8z" fill="currentColor" stroke="none" />,
  'set-square': <path d="M1.5 1.5V14.5H14.5Z M4.2 8V11.8H8" />,
  brackets: <path d="M5.4 1.9L.3 8l5.1 6.1M10.6 1.9L15.7 8l-5.1 6.1" />,
  pulse: <path d="M0 8.8h4.2l2.5-8 2.9 14.4 2.2-6.4H16" />,
  padlock: <><path d="M1.9 7.4h12.2V16H1.9z" fill="currentColor" /><path d="M4.3 7.7V4.8a3.7 3.7 0 0 1 7.4 0v2.9" /></>,
  check: <path d="M1 8.8l5.1 5.3L15.4 1.6" />,
  stopwatch: <><path d="M5.4 0h5.2v1.9H5.4z" fill="currentColor" /><path d="M8 1.6v1.9M14.1 9.6a6.1 6.1 0 1 1-12.2 0a6.1 6.1 0 1 1 12.2 0M8 9.6l3.8-3.2" /></>,
};

export function LensGlyphIcon({ glyph }: { glyph: GlyphSpec }) {
  const inner = glyph && typeof glyph === 'object' ? <path d={glyph.path} /> : SHAPES[glyph ?? ''] ?? <circle cx="8" cy="8" r="5.8" />;
  return <svg className="bp-lg" viewBox="0 0 16 16" aria-hidden="true">{inner}</svg>;
}
