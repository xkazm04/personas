/**
 * The words beside the stage stack, under it in the left rail so the centre
 * stays calm for the question card: what the last answer touched and, once
 * reconciled, how much it moved coverage and why; while the engine works with
 * no live question, that it is reading. The live region is ONE always-mounted
 * node whose text changes, so a screen reader hears each phase once.
 */
import { motion } from 'framer-motion';

import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';

import type { BlueprintDelta, SectionId, TwinBlueprintModel } from '../../blueprintContract';
import { TRAINING_TOPIC_PRESETS } from '../../../sub_training/topicPresets';

interface StageReadoutProps {
  model: TwinBlueprintModel;
  delta: BlueprintDelta | null;
  section: SectionId | null;
  working: boolean;
  reduced: boolean;
}

export function StageReadout({ model, delta, section, working, reduced }: StageReadoutProps) {
  const { t } = useTranslation();
  const tb = t.twin.blueprint;
  const preset = delta?.topicId ? TRAINING_TOPIC_PRESETS.find((p) => p.id === delta.topicId) : undefined;
  const topic = preset ? t.twin.training[preset.labelKey] : null;
  const kind = delta?.kind ? tb.kinds[delta.kind] : null;
  const scored = delta?.phase === 'reconciled';
  // "Coverage +{gain}": the words stay caption-sized, the sign travels with the big number.
  const [gainBefore = '', gainAfter = ''] = tb.delta.gain.split('{gain}');
  const [, gainWords = '', gainSign = ''] = /^(.*\s)?(\S*)$/.exec(gainBefore) ?? [];
  const loop = reduced ? undefined : 'dots';

  const gain = delta && scored && delta.coverageGain !== null ? (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5" data-testid="strata-delta-gain">
      {gainWords && <span className="typo-caption">{gainWords}</span>}
      <span className="typo-data-lg text-foreground">
        {gainSign}
        <Numeric value={delta.coverageGain} unit="ratio" precision={0} />
      </span>
      {gainAfter && <span className="typo-caption">{gainAfter}</span>}
    </span>
  ) : null;

  return (
    <div className="strata-readout" data-testid="strata-readout" data-phase={delta?.phase ?? (working ? 'working' : 'idle')}>
      <p className="sr-only" aria-live="polite">
        {delta ? (
          <>
            {tb.delta.recorded}. {scored ? gain : tb.delta.scoring}
            {scored && delta.why ? `. ${delta.why}` : ''}
          </>
        ) : working ? (
          tb.states.working
        ) : null}
      </p>

      {delta && section ? (
        <motion.div
          key={`${delta.answeredStepId}:${delta.phase}`}
          className="flex flex-col gap-2 min-w-0"
          initial={{ opacity: 0, y: reduced ? 0 : 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: reduced ? 0 : 0.5 }}
          aria-hidden
        >
          <span className="typo-eyebrow text-primary">{tb.delta.recorded}</span>
          <span className="typo-heading text-foreground">{tb.sections[section]}</span>
          {(topic || kind) && <span className="typo-caption">{[topic, kind].filter(Boolean).join(' · ')}</span>}
          {scored ? (
            <>
              {gain ?? <span className="typo-caption" data-measured="false">{tb.states.notMeasured}</span>}
              {delta.why && (
                <div className="flex flex-col gap-1 pt-1">
                  <span className="typo-label text-primary">{tb.delta.why}</span>
                  <p className="typo-body text-foreground" data-testid="strata-delta-why">{delta.why}</p>
                </div>
              )}
            </>
          ) : (
            <span className="typo-caption strata-dots" data-loop={loop}>{tb.delta.scoring}</span>
          )}
        </motion.div>
      ) : working ? (
        <div className="flex flex-col gap-2" aria-hidden>
          <span className="typo-heading text-foreground strata-dots" data-loop={loop}>{tb.states.working}</span>
        </div>
      ) : (
        <div className="flex flex-col gap-1" aria-hidden>
          <span className="typo-eyebrow text-primary">{tb.metrics.readiness}</span>
          <Numeric value={model.readiness.score / 100} unit="ratio" precision={0} className="typo-data-lg text-foreground" />
        </div>
      )}
    </div>
  );
}
