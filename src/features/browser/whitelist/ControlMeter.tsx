/**
 * How much of a site an agent can actually work — a three-segment meter, one
 * segment per rung of the control ladder.
 *
 * 0 filled = never scanned (we do not know), 1 = read-only, 2 = generic hands,
 * 3 = the page publishes its own tools. Drawn with semantic tokens and a
 * per-rung accent so the same grade reads the same colour as its `TierChip`.
 * Decorative by construction — `aria-hidden` with the grade named in text
 * beside it, because a bar with no words is not an accessible status.
 */
import { useTranslation } from '@/i18n/useTranslation';

import { BROWSER_MAX_TIER } from '../types';

/** One segment per rung, plus the "unknown" floor — 3 segments for tiers 0..2. */
const SEGMENTS = BROWSER_MAX_TIER + 1;

const FILL = ['bg-muted-foreground/50', 'bg-sky-400', 'bg-emerald-400'] as const;

export function ControlMeter({ tier }: { tier: number | null }) {
  const { t } = useTranslation();
  const w = t.browser.whitelist;
  const filled = tier === null ? 0 : Math.min(tier + 1, SEGMENTS);
  const fill = tier === null ? FILL[0] : FILL[Math.min(tier, FILL.length - 1)];
  const label = tier === null
    ? w.tier_unknown
    : [w.tier_0, w.tier_1, w.tier_2][tier] ?? w.tier_unknown;

  return (
    <div className="flex items-center gap-2 min-w-0">
      <span aria-hidden className="flex items-center gap-1 shrink-0">
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span
            key={i}
            className={`h-1.5 w-5 rounded-full transition-colors ${i < filled ? fill : 'bg-secondary/60'}`}
          />
        ))}
      </span>
      <span className="typo-caption text-foreground truncate">{label}</span>
    </div>
  );
}

export default ControlMeter;
