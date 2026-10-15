# Monitor surfaces (WP0)

`index.html` opens from disk: a static B/1 snapshot (6 of 14 bays, one Breach card) over the
candidate. Keys `1`-`8`, `T` theme, `G` blur, `C` compare, `D` card, `S` real scrim, `?`.
Shots in `shots/` are exact-surface 256-colour PNGs.

"Plate" = pixel spread inside the ribbon plate at 1920 dark, blur on / off; 0 means the glass hides the pattern.

| # | Candidate | Good for | With glass |
|---|---|---|---|
| 1 | Flat token | control | nothing behind the plates |
| 2 | Fine grain | tactile, printed | erased (0.00 / 1.81), but lifts the ground 4.5 levels, so glass reads darker than the floor; full-screen turbulence repaints under every blur |
| 3 | Dot grid | quiet structure | erased (0.00 / 1.84): clean frost, dots only in gutters; no swim, no banding |
| 4 | Tonal field | depth, theme hue | passes through (1.15 / 1.20): tints plates, cannot swim |
| 5 | Contour lines | character | muddy: lines blur into smudges (0.12 / 0.79) |
| 6 | Woven hairline | fabric | erased (0.00 / 1.10); busy gutters, moire risk when zoomed |
| 7 | Calm network | today's motif | muddy smudges (0.22 / 0.59); lines cross the header |
| 8 | Lit edge | frames the board | passes through (0.61); invisible mid-board |

**Recommendation: 3 + 4 together.** High and low frequency do not compete. The blur removes the dots
from every plate, which is what frosted glass should do, and the field restores the depth the raster
and `.hud-atmosphere` gave, in theme hues. Pure CSS on tokens, no paint cost, and light finally gets a
surface. If only one ships: 3.

## Port CSS (WP8)

Replace the `monitor-network-dark.webp` `<img>` and `.hud-atmosphere` with one
`<div aria-hidden className="monitor-surface" />` (absolute `inset-0 z-0 pointer-events-none`).

```css
.monitor-surface {
  background:
    radial-gradient(circle, color-mix(in srgb, var(--foreground) 22%, transparent) 0 1px, transparent 1.4px) 14px 14px / 28px 28px,
    radial-gradient(55% 60% at 8% 0%, color-mix(in srgb, var(--primary) 16%, transparent), transparent 70%),
    radial-gradient(45% 55% at 92% 18%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 70%),
    radial-gradient(70% 55% at 55% 105%, color-mix(in srgb, var(--status-info) 11%, transparent), transparent 70%);
}
[data-theme^="light"] .monitor-surface {
  background:
    radial-gradient(circle, color-mix(in srgb, var(--foreground) 18%, transparent) 0 1px, transparent 1.4px) 14px 14px / 28px 28px,
    radial-gradient(55% 60% at 8% 0%, color-mix(in srgb, var(--primary) 9%, transparent), transparent 70%),
    radial-gradient(45% 55% at 92% 18%, color-mix(in srgb, var(--accent) 7%, transparent), transparent 70%),
    radial-gradient(70% 55% at 55% 105%, color-mix(in srgb, var(--status-success) 6%, transparent), transparent 70%);
}
```

The gallery fades the dots downward (`mask-image: linear-gradient(180deg, #000 55%, rgba(0,0,0,.35))`);
to keep that, give the dots their own layer so the mask does not fade the field.
