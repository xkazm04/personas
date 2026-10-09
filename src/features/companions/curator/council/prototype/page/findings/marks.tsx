// PROTOTYPE ROUND (spark council-readout). The members' marks and the one
// score bar both page directions in WP4 draw (the Findings board and the
// Hybrid card), so a member reads the same on either.
//
// Null score is NOT MEASURED: the bar draws an empty dashed track, never a
// zero-length fill.
import { useMemo } from 'react';
import { Coins, Gem, Hammer, ShieldCheck, Swords, Undo2, type LucideIcon } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import type { Seat } from '../../../table/runModel';

const ICONS: Record<string, LucideIcon> = {
  value: Gem,
  craft: Hammer,
  rivalry: Swords,
  robustness: ShieldCheck,
  economics: Coins,
  reversibility: Undo2,
};

export function MemberIcon({ name, className = 'h-4 w-4' }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Gem;
  return <Icon className={className} aria-hidden="true" />;
}

/** The member's word, from the shipped council strings; a member this build does not know keeps its own name. */
export function useMemberName(): (name: string) => string {
  const { t } = useTranslation();
  const words = t.council.member;
  return (name: string) => {
    switch (name) {
      case 'value':
        return words.value;
      case 'craft':
        return words.craft;
      case 'rivalry':
        return words.rivalry;
      case 'robustness':
        return words.robustness;
      case 'economics':
        return words.economics;
      case 'reversibility':
        return words.reversibility;
      default:
        return name;
    }
  };
}

/** 0.5083 -> "0.51" in the reader's language. */
export function useScore(): (value: number) => string {
  const { language } = useTranslation();
  return useMemo(() => {
    const fmt = new Intl.NumberFormat(language, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return (value: number) => fmt.format(value);
  }, [language]);
}

export type ScoreTone = 'none' | 'floor' | 'under' | 'clear';

export function toneOf(seat: Pick<Seat, 'score' | 'floorHit' | 'threshold'>): ScoreTone {
  if (seat.score == null) return 'none';
  if (seat.floorHit) return 'floor';
  return seat.score >= seat.threshold ? 'clear' : 'under';
}

/** Ink per tone: identity (primary) for a normal reading, a status only when it means one. */
export const TONE_TEXT: Record<ScoreTone, string> = {
  none: 'text-muted',
  floor: 'text-status-error',
  under: 'text-foreground',
  clear: 'text-status-success',
};

const FILL: Record<ScoreTone, string> = {
  none: 'bg-transparent',
  floor: 'bg-status-error',
  under: 'bg-primary',
  clear: 'bg-status-success',
};

/** The stretch between a score and the bar: advisory amber, hatched so it never reads as a fill. */
export const GAP_HATCH =
  'repeating-linear-gradient(135deg, color-mix(in srgb, var(--status-warning) 55%, transparent) 0 3px, transparent 3px 7px)';

/**
 * One member's reading against the bar: fill to the score, a foreground tick
 * at the threshold, a red notch at the member's own floor, and the gap to the
 * bar drawn as a hatched stretch so "short by" is seen, not read.
 */
export function ScoreBar({
  score,
  threshold,
  floor,
  floorHit = false,
  height = 'h-2.5',
}: {
  score: number | null;
  threshold: number;
  floor: number | null;
  floorHit?: boolean;
  height?: string;
}) {
  const tone = toneOf({ score, floorHit, threshold });
  const pct = (v: number) => `${Math.max(0, Math.min(1, v)) * 100}%`;
  return (
    <div
      aria-hidden="true"
      className={`relative w-full ${height} rounded-pill ${
        score == null ? 'border border-dashed border-muted-dark/70' : 'bg-foreground/10'
      }`}
    >
      {score != null ? (
        <>
          <div className={`absolute inset-y-0 left-0 rounded-pill ${FILL[tone]}`} style={{ width: pct(score) }} />
          {score < threshold ? (
            <div
              className="absolute inset-y-0 rounded-pill"
              style={{
                left: pct(score),
                width: pct(threshold - score),
                backgroundImage: GAP_HATCH,
              }}
            />
          ) : null}
        </>
      ) : null}
      {floor != null ? (
        <div className="absolute -inset-y-1 w-0.5 bg-status-error" style={{ left: pct(floor) }} />
      ) : null}
      <div className="absolute -inset-y-1.5 w-0.5 rounded-pill bg-foreground" style={{ left: pct(threshold) }} />
    </div>
  );
}
