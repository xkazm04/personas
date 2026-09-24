import type { CSSProperties } from 'react';

// The plan sheet's grid paper: ONE layer of lines in the theme's primary. It
// was two (a 96 px grid over a 24 px grid) on top of the stage's radial glow,
// which read as noise behind the drawing.
export const BLUEPRINT_GRID: CSSProperties = {
  backgroundImage:
    'linear-gradient(color-mix(in srgb, var(--primary) 8%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--primary) 8%, transparent) 1px, transparent 1px)',
  backgroundSize: '48px 48px',
};
