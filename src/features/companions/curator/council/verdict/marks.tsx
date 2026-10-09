// The members' marks the verdict card and the queue share, so a member
// reads the same on either: its icon, its word, a score in the reader's
// language, and the tone a score carries against the bar.
//
// Null score is NOT MEASURED: nothing here turns it into a zero.
import { useMemo } from 'react';
import { Coins, Gem, Hammer, ShieldCheck, Swords, Undo2, type LucideIcon } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import type { Seat } from '../table/runModel';

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

/** The stretch between a score and the bar: advisory amber, hatched so it never reads as a fill. */
export const GAP_HATCH =
  'repeating-linear-gradient(135deg, color-mix(in srgb, var(--status-warning) 55%, transparent) 0 3px, transparent 3px 7px)';
