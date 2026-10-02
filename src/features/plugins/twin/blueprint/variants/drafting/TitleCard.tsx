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
 * The title block off paper (round 2 WP-C): on the inked page a Personas
 * strip (a card with two cells under eyebrows, a ruled divider between them,
 * readiness as a lit figure); natively the twin's identity card (its brand
 * glyph, name and role; readiness as a ring). The readiness figure is still
 * pressed last, after every other part of the sheet.
 */
export default function TitleCard({ model, slots }: { model: TwinBlueprintModel; slots: boolean }) {
  const { t } = useTranslation();
  const theme = useDraftingTheme();
  const b = t.twin.blueprint;
  const { identity, readiness } = model;

  return (
    <div data-testid="twd-title-block" data-title="card" className="twd-card twd-title relative flex min-w-0 flex-wrap items-stretch">
      <BoxFrame paper={null} />
      <div className="flex min-w-0 flex-1 basis-56 items-center gap-3 px-4 py-2.5" data-draw-scope="">
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
      <div className="relative flex min-w-0 items-center gap-4 px-4 py-2.5" data-draw-scope="">
        <i aria-hidden data-draw="frame" data-draw-wipe="y" className="twd-title-rule pointer-events-none absolute inset-y-3 left-0 w-px" />
        <div className={theme === 'native' ? 'flex items-center gap-3' : 'flex flex-col items-start gap-1'}>
          <Letter>{b.metrics.readiness}</Letter>
          {theme === 'native' ? <ReadinessRing score={readiness.score} /> : <Stamp score={readiness.score} />}
        </div>
        {slots && <ReadinessSlots slots={readiness.slots} />}
      </div>
    </div>
  );
}

/** The inked page's readiness: the figure in a lit frame, pressed last (no stamp's tilt). */
function Stamp({ score }: { score: number }) {
  return (
    <span data-draw="press" data-readiness={score} className="twd-stamp inline-flex shrink-0 items-baseline rounded-interactive px-2.5">
      <Numeric value={score} className="typo-data-lg" />
    </span>
  );
}

/**
 * The native readiness: a ring on the score's own scale (0..100), its track a
 * frame, its arc inked out to the score, the figure pressed into its middle
 * last. Complete is the success ink; anything short of it the theme's own.
 */
function ReadinessRing({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, Math.round(score)));
  return (
    <span className="relative inline-flex h-12 w-12 shrink-0 items-center justify-center" data-readiness={score} data-complete={pct >= 100}>
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
