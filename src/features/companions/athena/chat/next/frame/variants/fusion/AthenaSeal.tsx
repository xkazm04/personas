/**
 * Fusion · Athena's seal: her real portrait cropped to the face, set in a
 * ring of the theme's accent - the one branded mark the stage uses, on the
 * "Ask Athena" door and on the answer card she recommends once she has.
 *
 * TODO(prototype, 2026-10-07): athena chat fusion - consolidate after the owner picks.
 */

export function AthenaSeal({ size = 28 }: { size?: number }) {
  return (
    <span className="fu-seal" style={{ width: size, height: size }} aria-hidden>
      <span className="fu-face" />
    </span>
  );
}
