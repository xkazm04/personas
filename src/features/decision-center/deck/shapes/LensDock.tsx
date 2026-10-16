/**
 * A lens-scan card's dock (spark one-control, WP3): Open (Enter) over the
 * card's verdict pair, printed and DISABLED, with the line that says why
 * (decisions happen on the blueprint sheet, or in bp for a release), then
 * Later (S). Nothing on this dock writes.
 */
import { ArrowUpRight, Check, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { DecisionItem } from '../../model/decisionModel';
import { Later, Verdict } from '../DeckDock';
import type { DeckActions } from '../useDeckActions';

export function LensDock({ item, act, onOpen }: { item: DecisionItem; act: DeckActions; onOpen: () => void }) {
  const { t } = useTranslation();
  const L = t.decisionCenter.lens;
  const v = item.verdictLabels;
  const noop = () => undefined;
  return (
    <>
      <Verdict
        k="↵"
        label={item.kind === 'release' ? L.open_release : L.open_blueprint}
        yes
        tone="accent"
        icon={<ArrowUpRight className="h-4 w-4" strokeWidth={2.5} aria-hidden />}
        onClick={onOpen}
      />
      <div className="grid grid-cols-2 gap-2" role="group" aria-label={L.on_sheet} data-testid="lens-dock-verdicts">
        <Verdict k="A" label={v.accept} yes tone="success" pair disabled icon={<Check className="h-4 w-4" strokeWidth={2.5} aria-hidden />} onClick={noop} />
        <Verdict k="R" label={v.reject} yes={false} tone="danger" pair disabled icon={<X className="h-4 w-4" strokeWidth={2.5} aria-hidden />} onClick={noop} />
      </div>
      {/* A release is decided in bp, not on the blueprint sheet. */}
      <p className="typo-caption" data-testid="lens-dock-on-sheet">{item.kind === 'release' ? t.decisionCenter.release.sheet_read_only : L.on_sheet_hint}</p>
      <Later label={v.skip} onSkip={act.skip} />
    </>
  );
}
