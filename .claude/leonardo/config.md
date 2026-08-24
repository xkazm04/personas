# leonardo overlay - personas (desktop)

## Brand direction
**Neon android head** - representing AI agents of the new generation. Futuristic, glowing,
geometric, clean. Dark-first: assets are designed to sit on a dark surface and glow, not to be
lit from outside.

Never: photorealistic humans, stock-illustration "3D blob people", pastel corporate-memphis
flat art, drop shadows standing in for glow, or any generic-AI-assistant sparkle motif.

## Palette
Authoritative source: `src/styles/globals.css` (custom properties). Put the hex values, not the
names, into every prompt.
- primary `#06b6d4` (cyan) - the identity color
- accent `#22d3ee` (bright cyan) - glow and focus
- brand-purple `#a78bfa`, brand-emerald `#34d399`, brand-amber `#fbbf24`, brand-rose `#fb7185` -
  secondary accents; use ONE per asset alongside cyan, never all of them

## Theme adaptation
The app is themed. Hand-written SVGs use `currentColor` for the primary stroke/fill and
`var(--primary)` / `var(--accent)` / `var(--background)` for anything that must follow the theme.
Test an asset in both themes before integrating; a background that reads well on dark and vanishes
on light is not done.

## Output paths
- Icons / brand marks: beside the component that consumes them, or `src/assets/` for app-wide marks.
- State illustrations (empty / onboarding / success / error): beside the feature's component.
- Backgrounds: integrate at 8-15% opacity with a gradient fade to `var(--background)`.

## Defaults
- Icon / logo: 1024x1024, quality `high`, `--background transparent` on gpt-image-2 (Leonardo
  fallback: 512x512, `--style dynamic --contrast 3.5` + the remove-bg pipeline).
- State illustration: transparent background; Leonardo fallback needs `--style vibrant --contrast 3`
  with `--no-cleanup`, then `remove-bg`.
- Background: 1536x512, `--style cinematic --contrast 2.5`.
