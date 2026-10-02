import type { ReactNode } from 'react';
import DrawFrame from './draw/DrawFrame';
import { isPaperless, useDraftingTheme } from './draftingTheme';

/**
 * A region-sized box's outline, by theme (round 2 WP-C). On paper (the
 * cyanotype and the tinted sheet) it is the drafting frame the caller hands
 * in, unchanged. On the inked page and the native version the box is a
 * Personas card: its frame traces with its wave (a stroke, never a fade), its
 * fill lays in with the next wave under it (`data-draw-wipe="fade"`), and on
 * the inked page crop marks stand at its corners, traced with the fill. The
 * box itself carries `useCardBox()`'s class, which the theme's stylesheet
 * rounds, isolates (so the fill sits under the content) and colours.
 */
export default function BoxFrame({ paper }: { paper: ReactNode }) {
  const theme = useDraftingTheme();
  if (!isPaperless(theme)) return <>{paper}</>;
  return (
    <>
      <span aria-hidden data-draw="frame" data-draw-wipe="fade" className="twd-card-fill pointer-events-none absolute inset-0" />
      <DrawFrame stroke="var(--twd-card-line)" edge={0} />
      {theme === 'surface' && <CropMarks />}
    </>
  );
}

/** The class a box that may become a card carries (empty on paper). */
export function useCardBox(): string {
  return isPaperless(useDraftingTheme()) ? 'twd-card' : '';
}

/** A crop mark's arms, from its corner point (top-left; the others are this one turned). */
const CROP = 'M0 9 V0 H9';
const CORNERS = [
  { key: 'tl', at: { left: -6, top: -6 }, turn: 0 },
  { key: 'tr', at: { right: -6, top: -6 }, turn: 90 },
  { key: 'br', at: { right: -6, bottom: -6 }, turn: 180 },
  { key: 'bl', at: { left: -6, bottom: -6 }, turn: 270 },
] as const;

/**
 * The inked page's drafting accent on a card: a crop mark just outside each
 * corner, as a drawing marks the edge of what it frames. Each arm pair is a
 * frame one wave inside the card (traced as its fill lays in).
 */
function CropMarks() {
  return (
    <>
      {CORNERS.map(({ key, at, turn }) => (
        <svg key={key} aria-hidden width={9} height={9} className="twd-crop pointer-events-none absolute overflow-visible" style={{ ...at, rotate: `${turn}deg` }}>
          <path d={CROP} fill="none" stroke="var(--ink-dim)" strokeWidth={1} pathLength={100} data-draw="frame" />
        </svg>
      ))}
    </>
  );
}
