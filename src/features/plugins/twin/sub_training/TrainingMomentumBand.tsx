/**
 * TrainingMomentumBand — the training stage's baseline strip.
 *
 * Two numbers the training stage never showed: how many interviews this twin
 * has actually finished (`useTrainingMomentum`, which had no production caller
 * at all) and how thin each topic is (`scoreTopicCoverage`, which only ever
 * rendered AFTER a session completed, on the certificate screen).
 *
 * The governing rule is baseline-ladder: a coverage number with no visible
 * baseline is a score nobody asked against what. So the pills carry their tier
 * word, not a bare count, and the header states the baseline outright when it
 * is zero ("no sessions yet") rather than rendering an empty header.
 *
 * The pills are also the training topic picker. `SetupSessionApi.setTopic` has
 * existed since the v2 restructure with no caller, so the training stage asked
 * its questions with `topic: undefined` no matter how thin a subject was.
 */

import { useEffect, useState } from 'react';
import { GraduationCap } from 'lucide-react';
import * as twinApi from '@/api/twin/twin';
import { silentCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTrainingMomentum } from './useTrainingMomentum';
import { scoreTopicCoverage, topicByCommunication, type CoverageTier, type TopicCoverage } from './topicCoverage';
import { TRAINING_TOPIC_PRESETS, TRAINING_TOPIC_WINDOW } from './useTrainingSession';

const TIER_TINT: Record<CoverageTier, string> = {
  thin: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  some: 'border-cyan-500/25 bg-cyan-500/10 text-cyan-200',
  covered: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200',
};

const TIER_LABEL_KEY: Record<CoverageTier, 'coverageThin' | 'coverageSome' | 'coverageCovered'> = {
  thin: 'coverageThin',
  some: 'coverageSome',
  covered: 'coverageCovered',
};

/** Approved-memory coverage for one twin, refetched when the session says so. */
function useTopicCoverage(twinId: string | null, refreshToken?: unknown): TopicCoverage[] {
  const [coverage, setCoverage] = useState<TopicCoverage[]>(() => scoreTopicCoverage([]));

  useEffect(() => {
    if (!twinId) {
      setCoverage(scoreTopicCoverage([]));
      return;
    }
    let cancelled = false;
    // Both halves of the predicate: the memories, and the training sessions
    // that produced them. Without the second, a Czech values interview scores
    // zero on Values forever.
    Promise.all([
      twinApi.listPendingMemories(twinId, 'approved'),
      twinApi.listCommunications(twinId, 'training', TRAINING_TOPIC_WINDOW),
    ])
      .then(([mems, comms]) => {
        if (cancelled) return;
        setCoverage(scoreTopicCoverage(mems, topicByCommunication(comms)));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        silentCatch('TrainingMomentumBand:coverage')(err);
        setCoverage(scoreTopicCoverage([]));
      });
    return () => {
      cancelled = true;
    };
  }, [twinId, refreshToken]);

  return coverage;
}

interface Props {
  twinId: string | null;
  /** The training topic currently steering question generation, if any. */
  topic: string | null;
  /** Sets that topic: the prompt text the guide consumes, plus the preset id
   *  it came from, which is what coverage credits the resulting answers to. */
  onPickTopic: (topic: string, presetId: string) => void;
  /** Changes when a session saves, so both numbers re-read. */
  refreshToken?: unknown;
}

export function TrainingMomentumBand({ twinId, topic, onPickTopic, refreshToken }: Props) {
  const { t } = useTranslation();
  const tt = t.twin.training;
  const momentum = useTrainingMomentum(twinId, refreshToken);
  const coverage = useTopicCoverage(twinId, refreshToken);
  const tierById = new Map(coverage.map((c) => [c.id, c]));

  return (
    <div
      className="flex-shrink-0 px-4 md:px-6 xl:px-8 py-2.5 border-b border-primary/10 flex flex-wrap items-center gap-x-4 gap-y-2"
      data-testid="training-momentum-band"
    >
      <span className="flex items-center gap-2 flex-shrink-0">
        <GraduationCap className="w-3.5 h-3.5 text-violet-300" aria-hidden />
        <span className="typo-card-label" data-testid="training-momentum-sessions">
          {momentum.sessions} {tt.momentumSessions}
        </span>
        {momentum.lastTrainedAt ? (
          <span className="typo-caption">
            {tt.momentumLastTrained} <RelativeTime timestamp={momentum.lastTrainedAt} />
          </span>
        ) : (
          <span className="typo-caption" data-testid="training-momentum-never">
            {tt.momentumNever}
          </span>
        )}
      </span>

      <div
        className="flex flex-wrap items-center gap-1.5"
        role="group"
        aria-label={tt.coverageGroupLabel}
      >
        {TRAINING_TOPIC_PRESETS.map((preset) => {
          const scored = tierById.get(preset.id);
          const tier: CoverageTier = scored?.tier ?? 'thin';
          const prompt = tt[preset.promptKey];
          const selected = topic === prompt;
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onPickTopic(prompt, preset.id)}
              data-testid={`training-coverage-${preset.id}`}
              data-tier={tier}
              className={`px-2 py-1 rounded-interactive border typo-caption transition-colors flex items-center gap-1.5 ${TIER_TINT[tier]} ${
                selected ? 'ring-1 ring-violet-400/60' : 'hover:shadow-elevation-1'
              }`}
              aria-label={`${tt[preset.labelKey]}: ${tt[TIER_LABEL_KEY[tier]]}`}
            >
              {tt[preset.labelKey]}
              <span className="tabular-nums opacity-80">{scored?.count ?? 0}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default TrainingMomentumBand;
