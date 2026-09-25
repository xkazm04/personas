/**
 * WHERE A FIGURE WOULD BE, WHEN NOBODY HAS MEASURED IT.
 *
 * The page already owns an ink for this: the see-through, hatched box the nine
 * columns draw wherever nobody has looked. This is that same mark, used one
 * level up - in the verdict's hero slot, in a column head's count, in a band's
 * tally, beside a gauge - so the unpopulated page speaks the vocabulary its own
 * ledger speaks rather than inventing a second one.
 *
 * It is NOT a skeleton and NOT a shimmer. A shimmer says "this is arriving";
 * this says "nobody has looked", which is a different and permanent-until-run
 * fact, and telling them apart is the whole argument of the surface.
 *
 * The mark is announced as "not measured" rather than left as decoration,
 * because a hatched box read out as nothing is indistinguishable from a zero
 * to anyone who cannot see it.
 */
import { useWords } from '../words';

export function Unmeasured({ size, tip }: { size?: 'hero' | 'lg'; tip?: string }) {
  const { w } = useWords();
  return (
    <span
      className="cb-unmeasured"
      data-role="cb-unmeasured"
      data-size={size}
      data-cb-tip={tip ?? w.unmeasured_tip}
      role="img"
      aria-label={w.not_measured}
    >
      <span className="cb-unkbox" aria-hidden="true" />
    </span>
  );
}
