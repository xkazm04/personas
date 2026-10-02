import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import type { TwinBlueprintModel } from '../../blueprintContract';
import BoxFrame from './BoxFrame';
import { Letter } from './Lettering';
import ReadinessSlots from './ReadinessSlots';
import { TwinMark } from './SectionHead';
import Write from './draw/Write';

/**
 * The plan's title block, in the corner where a drafter puts it (the idiom of
 * Studio's DraftingTitleBlock, whose cells are a site build's and not a
 * twin's), drawn as the twin's identity card: its brand glyph, name and role,
 * a ruled divider, and readiness as a ring beside its four slots. In the
 * draw-in the card is a frame (depth 0), its fill and the divider trace with
 * the next wave, each cell writes its own words, and the readiness figure is
 * pressed last, once every other part of the sheet is drawn.
 */
export default function TwinTitleBlock({
  model,
  slots = true,
}: {
  model: TwinBlueprintModel;
  /** Stage mode leaves the slots out: the title block shares a band with the card. */
  slots?: boolean;
}) {
  const { t } = useTranslation();
  const b = t.twin.blueprint;
  const { identity, readiness } = model;

  return (
    <div data-testid="twd-title-block" data-title="card" className="twd-card twd-title relative flex min-w-0 flex-wrap items-stretch">
      <BoxFrame />
      <div className="flex min-w-0 flex-1 basis-56 items-center gap-3 px-3 py-2" data-draw-scope="">
        {/* Steps out of a narrow card (the overlay's corner) rather than squeeze the name: sheet.css. */}
        <span className="twd-title-mark contents">
          <TwinMark />
        </span>
        <div className="flex min-w-0 flex-col">
          <Letter>{b.variantCopy.drafting.sheetTitle}</Letter>
          <p className="line-clamp-2 typo-title-lg">
            <Write text={identity.name} />
          </p>
          <p className="line-clamp-2 typo-caption">
            <Write text={identity.role ?? t.twin.experience.sheet.noRole} />
          </p>
        </div>
      </div>
      {/* A drafting title block's cell layout (label over the figure and the slots), so the
          name and role keep their width and layer one keeps its row heights. */}
      <div className="relative flex min-w-0 flex-col justify-center gap-1 px-3 py-2" data-draw-scope="">
        <i aria-hidden data-draw="frame" data-draw-wipe="y" className="twd-title-rule pointer-events-none absolute inset-y-3 left-0 w-px" />
        <Letter>{b.metrics.readiness}</Letter>
        <div className="flex items-center gap-4">
          <ReadinessRing score={readiness.score} />
          {slots && <ReadinessSlots slots={readiness.slots} />}
        </div>
      </div>
    </div>
  );
}

/**
 * Readiness as a ring on the score's own scale (0..100), its track a
 * frame, its arc inked out to the score, the figure pressed into its middle
 * last. Complete is the success ink; anything short of it the theme's own.
 */
function ReadinessRing({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, Math.round(score)));
  return (
    <span className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center" data-readiness={score} data-complete={pct >= 100}>
      <svg aria-hidden viewBox="0 0 48 48" className="absolute inset-0 h-full w-full overflow-visible" style={{ rotate: '-90deg' }}>
        <circle cx={24} cy={24} r={21} fill="none" stroke="var(--twd-ring-track)" strokeWidth={3.5} pathLength={100} data-draw="frame" />
        {pct > 0 && (
          <circle
            className="twd-ring"
            cx={24}
            cy={24}
            r={21}
            fill="none"
            strokeWidth={3.5}
            pathLength={100}
            style={{ strokeDasharray: `${pct} 100` }}
            data-draw="ink"
          />
        )}
      </svg>
      <span data-draw="press" className="relative">
        <Numeric value={score} className="typo-data" />
      </span>
    </span>
  );
}
