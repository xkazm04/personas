/**
 * Deterministic star-field for the background constellation. Rendered with
 * low density so the backdrop reads as ambient atmosphere rather than
 * noise behind the hero card. Positions/radii are derived from a linear
 * congruential PRNG seeded by the star's index, so the layout is stable
 * across renders (no jitter on re-mount).
 */
export const QUESTIONNAIRE_CONSTELLATION_STARS = Array.from({ length: 42 }, (_, i) => {
  const s = (i * 9301 + 49297) % 233280;
  return {
    x: ((s * 17) % 700) - 350,
    y: ((s * 23) % 560) - 280,
    r: 0.4 + ((s * 5) % 100) / 140,
    delay: ((s * 13) % 100) / 25,
    dur: 2.8 + ((s * 7) % 30) / 10,
  };
});
