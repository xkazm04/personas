import type { ReactNode } from 'react';
import DrawFrame from './draw/DrawFrame';
import { hasCards, useDraftingTheme } from './draftingTheme';

/**
 * A region-sized box's outline, by theme level (round 3 WP-D). On the
 * cyanotype and in "Personas touch" it is the drafting frame the caller hands
 * in, unchanged. From "Half and half" on the box is a Personas card laid on
 * the paper: its frame traces with its wave (a stroke, never a fade), its fill
 * lays in with the next wave under it (`data-draw-wipe="fade"`), and
 * construction lines run on past its corners, traced with the fill, so the
 * card stays a thing drawn on the blueprint. The box itself carries
 * `useCardBox()`'s class, which the level's stylesheet rounds, isolates (so
 * the fill sits under the content) and colours.
 */
export default function BoxFrame({ paper }: { paper: ReactNode }) {
  const theme = useDraftingTheme();
  if (!hasCards(theme)) return <>{paper}</>;
  return (
    <>
      <span aria-hidden data-draw="frame" data-draw-wipe="fade" className="twd-card-fill pointer-events-none absolute inset-0" />
      <DrawFrame stroke="var(--twd-card-line)" edge={0} />
      <ConstructionLines />
    </>
  );
}

/** The class a box that may become a card carries (empty on paper). */
export function useCardBox(): string {
  return hasCards(useDraftingTheme()) ? 'twd-card' : '';
}

/** Past the corner by this much, into the gutter (narrower than the gutter, so neighbours never touch). */
const RUN = 10;
const BOX = RUN + 6;
/** The top-left corner's two lines, the card's top and left edges run on past the corner point. */
const LINES = `M0 ${RUN} H${BOX} M${RUN} 0 V${BOX}`;
const CORNERS = [
  { key: 'tl', at: { left: -RUN, top: -RUN }, turn: 0 },
  { key: 'tr', at: { right: -RUN, top: -RUN }, turn: 90 },
  { key: 'br', at: { right: -RUN, bottom: -RUN }, turn: 180 },
  { key: 'bl', at: { left: -RUN, bottom: -RUN }, turn: 270 },
] as const;

/**
 * A drafter's construction lines at a card's corners: its two edges run on
 * past the corner point, as they were laid out before the rounded corner was
 * drawn. Each corner's pair is a frame one wave inside the card (traced as its
 * fill lays in).
 */
function ConstructionLines() {
  return (
    <>
      {CORNERS.map(({ key, at, turn }) => (
        <svg key={key} aria-hidden width={BOX} height={BOX} className="twd-construction pointer-events-none absolute overflow-visible" style={{ ...at, rotate: `${turn}deg` }}>
          <path d={LINES} fill="none" stroke="var(--twd-construction)" strokeWidth={1} pathLength={100} data-draw="frame" />
        </svg>
      ))}
    </>
  );
}
