/**
 * Athena's face as a FIGURE on a control.
 *
 * Owner, 2026-10-03: *"Redesign also 'Talk to athena' button to include her visual, similar to card
 * in `.../chat/next/frame/variants/c/BinderPanel.tsx:117"*. That line is the binder card's art
 * band: her portrait masked into a hue-tinted gradient rather than reduced to a glyph. This is the
 * same treatment at control size — a ringed portrait chip over a primary-tinted fill, with the
 * portrait itself masked so it sits IN the band instead of on top of it.
 *
 * Doctrine 6c (2026-10-03) is what makes this legal: the kit governs STRUCTURE, not FIGURE. The
 * control around it is still `buttons/Button` — chrome, so the primitive owns it — and the drawing
 * inside is free, tokenised (`var(--primary)`, `var(--background)`, no literal colour) and theme-
 * agnostic. A labelled glyph in its place would lose the point, which is the test the doctrine sets.
 *
 * `athena_baseline.jpg` is the first frame of every clip `AthenaAvatar` plays, so her face here is
 * the same face the orb and the chat show; this draws the still only — no `<video>`, no decode, on
 * a control that is always mounted in the Cockpit header.
 */

/** The portrait chip: her face in a ringed, primary-tinted disc. Decorative — the control is named by its label. */
export function AthenaFigure({ size = 22 }: { size?: number }) {
  return (
    <span
      className="relative inline-grid place-items-center shrink-0 rounded-full overflow-hidden border border-primary/45"
      style={{ width: size, height: size, background: 'color-mix(in srgb, var(--primary) 24%, var(--background))' }}
      aria-hidden
    >
      <img
        src="/athena/athena_baseline.jpg"
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
        // Her eyes sit high in the frame; the still is a full figure, so the disc crops to the face.
        style={{ objectPosition: '50% 16%' }}
      />
    </span>
  );
}

/**
 * The art band behind the control: her hue washing left to right, as the binder card's band does.
 * A background, never a border — the `Button` keeps its own focus ring and border.
 */
export const ATHENA_BAND = {
  background:
    'linear-gradient(100deg, color-mix(in srgb, var(--primary) 28%, var(--background)), color-mix(in srgb, var(--primary) 7%, var(--background)) 82%)',
} as const;
