import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import type { TwinBlueprintModel } from '../../blueprintContract';
import BoxFrame from './BoxFrame';
import { Letter } from './Lettering';
import ReadinessSlots from './ReadinessSlots';
import { TwinMark } from './SectionHead';
import Write from './draw/Write';
import { useDraftingTheme } from './draftingTheme';

/**
 * The title block as a card (round 3 WP-D): in "Half and half" a Personas
 * strip on the paper (two cells under drafting labels, a ruled divider
 * between them, readiness stamped); in the "Personas blueprint" the twin's
 * identity card (its brand glyph, name and role; readiness as a ring). The
 * readiness figure is still pressed last, after every other part of the
 * sheet.
 */
export default function TitleCard({ model, slots }: { model: TwinBlueprintModel; slots: boolean }) {
  const { t } = useTranslation();
  const theme = useDraftingTheme();
  const b = t.twin.blueprint;
  const { identity, readiness } = model;

  return (
    <div data-testid="twd-title-block" data-title="card" className="twd-card twd-title relative flex min-w-0 flex-wrap items-stretch">
      <BoxFrame paper={null} />
      <div className="flex min-w-0 flex-1 basis-56 items-center gap-3 px-3 py-2" data-draw-scope="">
        {/* Steps out of a narrow card (the overlay's corner) rather than squeeze the name: native.css. */}
        {theme === 'native' && (
          <span className="twd-title-mark contents">
            <TwinMark />
          </span>
        )}
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
      {/* The paper title block's cell layout (label over the figure and the slots), so the
          name and role keep the same width on a card and layer one keeps its row heights. */}
      <div className="relative flex min-w-0 flex-col justify-center gap-1 px-3 py-2" data-draw-scope="">
        <i aria-hidden data-draw="frame" data-draw-wipe="y" className="twd-title-rule pointer-events-none absolute inset-y-3 left-0 w-px" />
        <Letter>{b.metrics.readiness}</Letter>
        <div className="flex items-center gap-4">
          {theme === 'native' ? <ReadinessRing score={readiness.score} /> : <Stamp score={readiness.score} />}
          {slots && <ReadinessSlots slots={readiness.slots} />}
        </div>
      </div>
    </div>
  );
}

/** "Half and half"'s readiness: the figure stamped in a lit frame, pressed last. */
function Stamp({ score }: { score: number }) {
  return (
    <span data-draw="press" data-readiness={score} className="twd-stamp inline-flex shrink-0 items-baseline rounded-interactive px-2.5">
      <Numeric value={score} className="typo-data-lg" />
    </span>
  );
}

/**
 * The "Personas blueprint" readiness: a ring on the score's own scale (0..100), its track a
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
