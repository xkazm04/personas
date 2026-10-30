// Lens MVPs - one compact card per scan lens above the backlog list: the
// lens's current MVP (the open item flagged `mvp` from the lens's latest sweep
// run, else its open item with the top score; `lensMvps` decides). A sweep
// judges every unit through every lens, so this strip is where a lens whose
// best finding scored below the cut still shows its best finding.
import { LevelBadge } from '@/features/plugins/dev-tools/constants/ideaBadges';
import { TruncateWithTooltip } from '@/features/shared/components/display/TruncateWithTooltip';
import { useTranslation } from '@/i18n/useTranslation';

import { lensMvps, type BacklogIdea } from './backlogModel';
import { ScoreChip } from './ScanFindingChips';

/** Cards shown before the strip scrolls sideways. */
const MAX_CARDS = 12;

export function LensMvpStrip({
  rows,
  onOpen,
}: {
  rows: readonly BacklogIdea[];
  onOpen: (row: BacklogIdea) => void;
}) {
  const { t } = useTranslation();
  const r = t.overview.review;
  const mvps = lensMvps(rows).slice(0, MAX_CARDS);
  if (mvps.length === 0) return null;
  return (
    <section aria-label={r.backlog_mvps_title} className="flex flex-col gap-1.5">
      <h3 className="typo-label text-foreground">{r.backlog_mvps_title}</h3>
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {mvps.map((m) => (
          <li key={m.lens ?? m.id} className="shrink-0 w-64">
            <MvpCard idea={m} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function MvpCard({ idea, onOpen }: { idea: BacklogIdea; onOpen: (row: BacklogIdea) => void }) {
  const { t } = useTranslation();
  const r = t.overview.review;
  return (
    // A whole-card press target: one local element, the documented exception
    // to `raw-button-element` (the shared Button has no class merge).
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpen(idea); }}
      className="w-full text-left flex flex-col gap-1.5 rounded-card border border-primary/15 bg-secondary/20 p-2.5 hover:bg-primary/5 transition-colors"
    >
      <span className="flex items-center justify-between gap-2 min-w-0">
        <span className="typo-caption text-primary truncate">{idea.lens}</span>
        <ScoreChip idea={idea} />
      </span>
      <TruncateWithTooltip text={idea.title} className="typo-body text-foreground min-w-0 w-full" />
      <span className="flex flex-wrap gap-1">
        <LevelBadge label={r.backlog_impact} value={idea.impact} />
        <LevelBadge label={r.backlog_effort} value={idea.effort} />
        <LevelBadge label={r.backlog_risk} value={idea.risk} />
      </span>
    </button>
  );
}
