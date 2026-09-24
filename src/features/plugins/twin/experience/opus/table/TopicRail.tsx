/**
 * The training deck, down the left of the table while the training stage is
 * on. One card per topic: what it asks, and how thin it still is. Picking a
 * card sets the topic AND deals a question on it at once (`onPick` → the
 * table redeals), which the old momentum band never did — its pills changed
 * only the question after next.
 */

import { GraduationCap } from 'lucide-react';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import type { CoverageTier, TopicCoverage } from '../../../sub_training/topicCoverage';
import { TOPIC_DECK, type TopicCard } from './topicDeck';

const TIER_PIPS: Record<CoverageTier, number> = { thin: 1, some: 2, covered: 3 };

interface TopicRailProps {
  topicPreset: string | null;
  coverage: TopicCoverage[];
  sessions: number;
  lastTrainedAt: string | null;
  onPick: (card: TopicCard, prompt: string) => void;
}

export function TopicRail({ topicPreset, coverage, sessions, lastTrainedAt, onPick }: TopicRailProps) {
  const { t, tx } = useTranslation();
  const xo = t.twin.experience_opus;
  const byId = new Map(coverage.map((c) => [c.id, c]));

  return (
    <nav aria-label={xo.topics.label} className="space-y-2.5" data-testid="xo-topics">
      <div className="px-1 space-y-0.5">
        <p className="typo-label">{xo.topics.label}</p>
        <p className="typo-caption flex items-center gap-1.5">
          <GraduationCap className="w-3.5 h-3.5 text-primary" aria-hidden />
          {tx(xo.topics.sessions, { count: sessions })}
          {lastTrainedAt && (
            <>
              {' · '}
              <RelativeTime timestamp={lastTrainedAt} />
            </>
          )}
        </p>
      </div>
      {TOPIC_DECK.map((card) => {
        const copy = xo.topics[card.key];
        const scored = byId.get(card.id);
        const tier: CoverageTier = scored?.tier ?? 'thin';
        const active = topicPreset === card.id;
        return (
          <button
            key={card.id}
            type="button"
            onClick={() => onPick(card, copy.prompt)}
            aria-pressed={active}
            data-picked={active}
            data-testid={`xo-topic-${card.id}`}
            className={`focus-ring w-full xo-card xo-foil xo-suit-memories rounded-card px-3 py-2.5 text-left flex gap-3 ${
              active ? 'xo-foil-live xo-glow' : ''
            }`}
          >
            <card.Icon className="w-4 h-4 mt-0.5 flex-shrink-0 text-[var(--xo-hue)]" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block typo-title text-foreground">{copy.label}</span>
              <span className="block typo-caption line-clamp-2">{copy.blurb}</span>
            </span>
            <span className="flex flex-col items-end gap-1 flex-shrink-0">
              <span className="sr-only">
                {tx(xo.topics.coverage, { tier: xo.topics.tiers[tier], count: scored?.count ?? 0 })}
              </span>
              <span aria-hidden className="flex gap-0.5">
                {[1, 2, 3].map((n) => (
                  <span
                    key={n}
                    className={`w-1.5 h-3 rounded-pill ${n <= TIER_PIPS[tier] ? 'bg-[var(--xo-hue)]' : 'bg-foreground/15'}`}
                  />
                ))}
              </span>
              <span aria-hidden className="typo-caption tabular-nums">
                {scored?.count ?? 0}
              </span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}

export default TopicRail;
