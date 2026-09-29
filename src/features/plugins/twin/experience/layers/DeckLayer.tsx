/**
 * What the next questions are about, one layer down.
 *
 * The six topics are the app's own `TRAINING_TOPIC_PRESETS` — the same ids the
 * coverage scorer credits answers to, so nothing already saved loses its
 * score, and the same labels the Training Room uses, so the vocabulary does
 * not fork. Each carries how thin it is: three pips and a count, which is what
 * makes the deck a decision rather than a list.
 */

import { Check } from 'lucide-react';
import { Layers } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { CoverageTier, TopicCoverage } from '../../sub_training/topicCoverage';
import { TRAINING_TOPIC_PRESETS } from '../../sub_training/useTrainingSession';
import { LayerFrame } from './LayerFrame';

const PIPS: Record<CoverageTier, number> = { thin: 1, some: 2, covered: 3 };

interface DeckLayerProps {
  open: boolean;
  onClose: () => void;
  topicPreset: string | null;
  coverage: TopicCoverage[];
  rounds: number;
  onPick: (prompt: string, presetId: string) => void;
}

export function DeckLayer({ open, onClose, topicPreset, coverage, rounds, onPick }: DeckLayerProps) {
  const { t, tx: fmt } = useTranslation();
  const tx = t.twin.experience.deck;
  const tt = t.twin.training;
  const byId = new Map(coverage.map((c) => [c.id, c]));

  return (
    <LayerFrame
      open={open}
      onClose={onClose}
      icon={<Layers className="w-4 h-4" />}
      title={tx.title}
      hint={tx.hint}
      aside={<span className="typo-caption tabular-nums">{fmt(tx.rounds, { count: rounds })}</span>}
      testId="mr-deck"
    >
      <ul className="px-5 py-4 space-y-1.5">
        {TRAINING_TOPIC_PRESETS.map((preset) => {
          const scored = byId.get(preset.id);
          const tier: CoverageTier = scored?.tier ?? 'thin';
          const active = topicPreset === preset.id;
          return (
            <li key={preset.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(tt[preset.promptKey], preset.id);
                  onClose();
                }}
                aria-pressed={active}
                data-picked={active}
                data-testid={`mr-topic-${preset.id}`}
                className="mr-slat focus-ring w-full flex items-center gap-3 rounded-card px-4 py-3 pl-5 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block typo-title text-foreground">{tt[preset.labelKey]}</span>
                  <span className="block typo-caption line-clamp-1">{tt[preset.promptKey]}</span>
                </span>
                <span className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span className="sr-only">
                    {fmt(tx.coverage, { tier: tx.tiers[tier], count: scored?.count ?? 0 })}
                  </span>
                  <span aria-hidden className="flex gap-0.5">
                    {[1, 2, 3].map((n) => (
                      <span
                        key={n}
                        className={`w-1.5 h-3 rounded-pill ${n <= PIPS[tier] ? 'bg-primary' : 'bg-foreground/15'}`}
                      />
                    ))}
                  </span>
                  <span aria-hidden className="typo-caption tabular-nums">
                    {scored?.count ?? 0}
                  </span>
                </span>
                {active && <Check className="w-4 h-4 flex-shrink-0 text-primary" aria-hidden />}
              </button>
            </li>
          );
        })}
      </ul>
    </LayerFrame>
  );
}

export default DeckLayer;
