/**
 * One plain ledger fact. A concept that is universal and repeats on every
 * item (first seen, occurrences, project, spend, members…) is drawn as an icon
 * with its label in a tooltip, the value as the hero. A fact this deck has no
 * glyph for keeps its label as small-caps text — it is unique to the item, so
 * the word is the meaning (a policy's quality delta vs its cost delta would
 * be two indistinguishable glyphs over two percentages).
 */
import { Folder, History, PiggyBank, Repeat, Target, Trophy, Users, Wallet, Zap, type LucideIcon } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { TONE_TEXT } from '@/features/agents/quick-answer/triage/deck/DeckChips';
import type { TriageFact } from '@/features/agents/quick-answer/triage/triageTypes';

const FACT_ICON: Record<string, LucideIcon> = {
  first: History,
  count: Repeat,
  project: Folder,
  spend: Wallet,
  saves: PiggyBank,
  members: Users,
  wins: Trophy,
  kpi: Target,
  action: Zap,
};

export function FactLine({ fact }: { fact: TriageFact }) {
  const Icon = FACT_ICON[fact.id];
  const ink = fact.tone ? TONE_TEXT[fact.tone] : 'text-foreground';
  if (!Icon) {
    return (
      <div className="flex items-baseline justify-between gap-3">
        <span className="typo-eyebrow text-foreground">{fact.label}</span>
        <span className={`min-w-0 text-right typo-data [overflow-wrap:anywhere] ${ink}`}>{fact.value}</span>
      </div>
    );
  }
  return (
    <Tooltip content={fact.label}>
      <div className="flex items-center gap-2.5" tabIndex={0} aria-label={`${fact.label}: ${fact.value}`}>
        <Icon className="h-4 w-4 au-quiet flex-shrink-0" aria-hidden />
        <span className={`min-w-0 typo-data [overflow-wrap:anywhere] ${ink}`}>{fact.value}</span>
      </div>
    </Tooltip>
  );
}
