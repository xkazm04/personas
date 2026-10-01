import { motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { formatNumeric } from '@/lib/utils/formatters';
import type { BlueprintDelta, TwinBlueprintModel } from '../../blueprintContract';
import { Letter } from './Lettering';

/**
 * What the notes say in stage mode. The last answer first (recorded, on what,
 * while it is being scored), then, once the reconcile pass lands, the coverage
 * it gained and the model's one-line reason; otherwise when the twin last
 * trained (while the engine works, the open middle of the sheet says so).
 * Two blocks side by side under the card, stacked where the notes are narrow.
 */
export default function DeltaNote({
  model,
  delta,
  targetLabel,
  reduced,
}: {
  model: TwinBlueprintModel;
  delta: BlueprintDelta | null;
  /** The topic, goal, channel or section the answer landed on. */
  targetLabel: string | null;
  reduced: boolean;
}) {
  const { t, tx, language } = useTranslation();
  const b = t.twin.blueprint;
  const key = delta ? `${delta.answeredStepId}:${delta.phase}` : 'idle';
  const enter = reduced ? { initial: { opacity: 0 }, animate: { opacity: 1 } } : { initial: { opacity: 0, x: -10 }, animate: { opacity: 1, x: 0 } };

  return (
    <motion.div key={key} {...enter} transition={{ duration: 0.45, ease: 'easeOut' }} className="flex min-w-0 flex-wrap items-start gap-x-6 gap-y-2" data-note={key}>
      {delta?.phase === 'reconciled' ? (
        <>
          <div className="flex min-w-0 flex-col">
            {delta.coverageGain !== null ? (
              <Numeric className="whitespace-nowrap typo-data-lg text-foreground">
                {tx(b.delta.gain, { gain: formatNumeric(delta.coverageGain, 'ratio', { precision: 0, language }) })}
              </Numeric>
            ) : (
              <Letter strong>{b.delta.recorded}</Letter>
            )}
            {targetLabel && <span className="typo-caption">{targetLabel}</span>}
          </div>
          {delta.why && (
            <div className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
              <Letter>{b.delta.why}</Letter>
              <p className="line-clamp-3 typo-body text-foreground">{delta.why}</p>
            </div>
          )}
        </>
      ) : delta ? (
        <>
          <div className="flex min-w-0 flex-col">
            <Letter strong>{b.delta.recorded}</Letter>
            {targetLabel && <p className="typo-body-lg text-foreground">{targetLabel}</p>}
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            {delta.kind && <span className="typo-caption">{b.kinds[delta.kind]}</span>}
            <Scoring label={b.delta.scoring} reduced={reduced} />
          </div>
        </>
      ) : (
        <span className="flex flex-wrap items-baseline gap-x-3">
          <Letter>{b.metrics.lastTrained}</Letter>
          {model.training.lastTrainedAt ? (
            <RelativeTime timestamp={model.training.lastTrainedAt} className="typo-body text-foreground" />
          ) : (
            <span className="typo-caption">{b.metrics.neverTrained}</span>
          )}
        </span>
      )}
    </motion.div>
  );
}

/** The pen still working: a hatch that marches (Studio's CSS loop), static under reduced motion. */
function Scoring({ label, reduced }: { label: string; reduced: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden data-live={!reduced} className={`block h-3 w-14 shrink-0 ${reduced ? 'twd-hatch' : 'drafting-hatch'}`} style={{ border: '1px solid var(--ink-dim)' }} />
      <span className="typo-caption">{label}</span>
    </span>
  );
}
