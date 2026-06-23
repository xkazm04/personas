// Cover gauge for the golden-standard rubric: the weighted % of this project's
// archetype targets met, with the still-below-target dimensions in the tooltip.
// Turns "is this app golden?" from a vibe into a fair, tier-aware number.
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { scoreTint, ARCHETYPE_LABEL, type AppPassport } from '../passportModel';
import { scoreAgainstRubric } from './goldenStandard';

export function GoldenGauge({ passport }: { passport: AppPassport }) {
  const r = scoreAgainstRubric(passport);
  const tint = scoreTint(r.goldenPct);
  const tip = r.belowTarget.length
    ? `Below the ${ARCHETYPE_LABEL[r.archetype]} golden standard on: ${r.belowTarget.map((d) => d.label).join(', ')}`
    : `Meets the ${ARCHETYPE_LABEL[r.archetype]} golden standard`;
  return (
    <Tooltip content={tip}>
      <span className="inline-flex items-center gap-1.5 w-full cursor-default">
        <span className="typo-label text-foreground/45 flex-shrink-0">Golden</span>
        <span className="relative flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'color-mix(in srgb, var(--foreground) 9%, transparent)' }}>
          <span className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500" style={{ width: `${r.goldenPct}%`, background: tint.hex }} />
        </span>
        <span className={`typo-caption tabular-nums font-semibold leading-none ${tint.text} flex-shrink-0`}>{r.goldenPct}%</span>
        {r.belowTarget.length > 0 && (
          <span className="typo-label text-foreground/40 flex-shrink-0">· {r.belowTarget.length}&nbsp;below</span>
        )}
      </span>
    </Tooltip>
  );
}
