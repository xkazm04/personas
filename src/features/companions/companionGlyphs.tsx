/**
 * @catalog The two companion brand marks as inline glyphs, on the lucide 24x24 grid.
 *
 * Athena and Overseer became addressable from outside their own pages (the
 * Activity surface's persona menu flags a session for Athena and stars a
 * persona into Overseer's scope), so each needs a mark that survives at 16px
 * beside a menu label. Athena already had a PORTRAIT - `/athena/athena_baseline.jpg`
 * plus four mp4 loops behind `AthenaAvatar` - but a photograph is not an icon:
 * it cannot take the theme's ink and it is unreadable at menu size. These are
 * the icon half of each identity, not a replacement for the portrait.
 *
 * INLINE, NOT A FILE. An `<img src="...svg">` cannot inherit `currentColor`, so
 * a file would need one asset per theme. As components they are `currentColor`
 * throughout.
 *
 * ONE APPEARANCE EACH, AND THAT IS A MEASURED DECISION. The first cut of this
 * file carried a `filled` prop that thickened strokes for the ON state. Rendered
 * and looked at on the 16/20/24/48px ladder in both themes, the two states were
 * nearly indistinguishable at the only size that matters - the menu's 16px - so
 * the prop was signalling nothing exactly where it had to signal. State is now
 * the CALLER's job and belongs outside the glyph: the on state puts the mark on
 * a filled chip, which reads instantly at 16px, while an internal stroke change
 * does not. (It is not opacity either way; the style doctrine forbids spending
 * opacity on meaning.)
 *
 * Both marks were generated as references with the Antigravity CLI (Nano
 * Banana 2) and then authored by hand on the 24x24 grid, because a traced
 * raster carries the generator's wobble into every size the app draws it at.
 * The references live outside the repo; the geometry below is the artifact.
 */

export interface CompanionGlyphProps {
  className?: string;
}

const BASE = {
  viewBox: '0 0 24 24',
  xmlns: 'http://www.w3.org/2000/svg',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  width: '1em',
  height: '1em',
  'aria-hidden': true,
} as const;

/**
 * Athena: an owl's face, her own Greek symbol. Two ringed eyes under swept ear
 * tufts. The pupils stay solid at every size so the face keeps a focus when the
 * rings close up at 16px.
 */
export function AthenaGlyph({ className = '' }: CompanionGlyphProps) {
  return (
    <svg {...BASE} className={className}>
      {/* Ear tufts: what makes two circles read as an owl rather than goggles. */}
      <path d="M3.4 5.6c2.3.3 4.1 1.1 5.4 2.4" />
      <path d="M20.6 5.6c-2.3.3-4.1 1.1-5.4 2.4" />
      <circle cx="8.3" cy="12.6" r="4.7" />
      <circle cx="15.7" cy="12.6" r="4.7" />
      <circle cx="8.3" cy="12.6" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="15.7" cy="12.6" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * Overseer: a shelter arc over the three agents beneath it, the middle one
 * nearest. Oversight OF A ROSTER rather than a bare eye - an eye would have
 * been Lucide's stock glyph with no identity of its own, and it says
 * "watching" where this says "watching these". The dots are solid and the arc
 * sits high so the two do not merge into one blob at 16px.
 */
export function OverseerGlyph({ className = '' }: CompanionGlyphProps) {
  return (
    <svg {...BASE} className={className}>
      <path d="M3.2 13.4a8.8 8.8 0 0 1 17.6 0" />
      <circle cx="12" cy="19" r="2.6" fill="currentColor" stroke="none" />
      <circle cx="5.3" cy="19.4" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="18.7" cy="19.4" r="1.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** The mark for a companion id, so a caller switches on data, never on a name. */
export const COMPANION_GLYPH = {
  athena: AthenaGlyph,
  overseer: OverseerGlyph,
} as const;
