/**
 * What an armed valve will do, said in the dock BEFORE the second press: the
 * kind of thing that leaves and exactly which item, then how to back out. It
 * replaces nothing — the verdict pair stays under it, the yes now reading
 * "↵ to confirm" — so the confirming key is the one the operator just pressed.
 */
import { Lock } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { DecisionIrreversible } from '../model/decisionModel';
import { leavesLine } from './outcome';
import { Keycap } from './parts';

export function ArmedBox({ kind, title }: { kind: DecisionIrreversible; title: string }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  return (
    <div className="au-armed au-l-danger flex flex-col gap-1.5 rounded-input px-3 py-2.5" role="alert" data-testid="deck-armed-box">
      <span className="au-ink-lamp flex items-center gap-1.5 typo-eyebrow">
        <Lock className="h-3.5 w-3.5" aria-hidden />
        {m.dc_deck_armed_title}
      </span>
      <span className="typo-body text-foreground [overflow-wrap:anywhere]">{leavesLine(m, tx, kind, title)}</span>
      <span className="flex items-center gap-1.5 typo-caption">
        <Keycap>Esc</Keycap> {m.dc_deck_armed_disarm}
      </span>
    </div>
  );
}
