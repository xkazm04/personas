import { motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { BreakMark, Letter } from './Lettering';
import { BIO_SCALE_FACTOR, onScale } from './draftingTwinModel';

/**
 * The bio as a dimension line against its target: extension lines, arrows and
 * the line itself drawn on a scale that runs to four times the target (a
 * declared domain), the target as a datum triangle above it. A longer bio
 * runs the whole scale and carries a "not to scale" break; no bio leaves only
 * the dashed scale, measured as nothing drawn rather than as a zero.
 */
export default function DimensionLine({
  value,
  target,
  detailed = false,
  drawn,
  reduced,
}: {
  value: number | null;
  target: number;
  /** L2: the scale is ticked and lettered. */
  detailed?: boolean;
  drawn: boolean;
  reduced: boolean;
}) {
  const { t, tx } = useTranslation();
  const copy = t.twin.blueprint.variantCopy.drafting;
  const max = target * BIO_SCALE_FACTOR;
  const { share, broken } = value === null ? { share: 0, broken: false } : onScale(value, max);
  const targetAt = `${(target / max) * 100}%`;
  const at = `${share * 100}%`;
  const line = drawn && !reduced ? { initial: { scaleX: 0 }, animate: { scaleX: 1 } } : {};
  const ticks = [0, 1, 2, 3, 4].map((k) => k * target);

  return (
    <div className="flex flex-col gap-1" data-measured={value === null ? 'false' : 'true'}>
      <div className={`relative ${detailed ? 'h-12' : 'h-8'}`}>
        <div aria-hidden className="absolute inset-x-0 bottom-3 border-t border-dashed" style={{ borderColor: 'var(--ink-faint)' }} />
        <Tooltip content={tx(copy.targetOf, { count: target })}>
          <span
            className="absolute bottom-4 -translate-x-1/2"
            style={{ left: targetAt, width: 0, height: 0, borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderTop: '9px solid var(--ink-strong)' }}
          />
        </Tooltip>
        {detailed && (
          <span className="absolute top-0 -translate-x-1/2" style={{ left: targetAt }}>
            <Letter>{copy.target}</Letter>
          </span>
        )}
        <i aria-hidden className="absolute bottom-0 left-0 h-6 w-px" style={{ background: 'var(--ink-dim)' }} />
        {value !== null && value > 0 && (
          <>
            <i aria-hidden className="absolute bottom-0 h-6 w-px" style={{ left: at, background: 'var(--ink-dim)' }} />
            <motion.div
              aria-hidden
              {...line}
              transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
              className="absolute bottom-3 left-0 flex origin-left items-center"
              style={{ width: at }}
            >
              <Arrow dir="left" />
              <span className="h-0 flex-1" style={{ borderTop: '1.5px solid var(--ink-strong)' }} />
              {broken && <BreakMark />}
              {broken && <span className="h-0 w-3" style={{ borderTop: '1.5px solid var(--ink-strong)' }} />}
              <Arrow dir="right" />
            </motion.div>
          </>
        )}
      </div>
      {detailed && (
        <div className="relative h-6" aria-hidden>
          {/* The end figures sit inside the scale, so the region's edge never cuts them. */}
          {ticks.map((n, i) => (
            <span
              key={n}
              className={`absolute top-0 typo-code text-foreground ${i === 0 ? '' : i === ticks.length - 1 ? '-translate-x-full' : '-translate-x-1/2'}`}
              style={{ left: `${(n / max) * 100}%` }}
            >
              <Numeric value={n} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Arrow({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg aria-hidden width={8} height={8} className="shrink-0 overflow-visible">
      <path d={dir === 'left' ? 'M0 4 L8 0 L8 8 Z' : 'M8 4 L0 0 L0 8 Z'} fill="var(--ink-strong)" />
    </svg>
  );
}
