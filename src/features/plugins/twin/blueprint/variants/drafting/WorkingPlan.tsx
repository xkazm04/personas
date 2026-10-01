import { useTranslation } from '@/i18n/useTranslation';
import { Letter } from './Lettering';

/** The layer-one plan in miniature: identity, knowledge, voice, training, title block. */
const PLAN_RECTS = [
  { x: 0, y: 0, w: 80, h: 46 },
  { x: 86, y: 0, w: 110, h: 92 },
  { x: 0, y: 52, w: 80, h: 68 },
  { x: 202, y: 0, w: 78, h: 92 },
  { x: 86, y: 98, w: 194, h: 22 },
] as const;

/**
 * The waiting surface while the engine works with no question: the twin's
 * plan in miniature, its frames traced over and over by the pen (a CSS loop,
 * `.twd-trace-loop`, which the app's reduced-motion reset stops; under the
 * `reduced` prop the frames are simply drawn).
 */
export default function WorkingPlan({ reduced }: { reduced: boolean }) {
  const { t } = useTranslation();
  const b = t.twin.blueprint;
  return (
    <div className="flex flex-col items-center gap-4" data-testid="twd-working">
      <Letter strong>{b.variantCopy.drafting.sheetTitle}</Letter>
      <svg aria-hidden width={280} height={120} viewBox="-1 -1 282 122" className={`overflow-visible ${reduced ? '' : 'twd-trace-loop'}`} data-live={!reduced}>
        {PLAN_RECTS.map((r, i) => (
          <g key={i}>
            <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke="var(--ink-faint)" strokeDasharray="4 3" />
            <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke="var(--ink)" strokeWidth={1.5} pathLength={100} />
          </g>
        ))}
      </svg>
      <span className="typo-body text-foreground">{b.states.working}</span>
    </div>
  );
}
