// The Approvals decision center has TWO kinds of decision, and until they were
// joined each was written in its own visual idiom and lived in its own place:
// persona Manual Review here, and the Dev Tools backlog wedged in as a
// collapsible strip inside this inbox. Same human, same act ("should this be
// accepted?"), two surfaces.
//
// This is the switch between them. Manual Review is the superior path, so the
// backlog adopts ITS shell — ContentBox → header → mode tabs → body — rather
// than keeping its own chrome. (A third mode, Workspace Knowledge, was retired
// with the in-app knowledge library.)
import type { LucideIcon } from 'lucide-react';
import { ClipboardCheck, ScanSearch } from 'lucide-react';

import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { useTranslation } from '@/i18n/useTranslation';

export type DecisionMode = 'reviews' | 'backlog';

/** SegmentedTab carries a ReactNode label and nothing else, so the icon and the
 *  pending badge are composed into it rather than added as new tab props. */
function TabLabel({ icon: Icon, label, count }: { icon: LucideIcon; label: string; count: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="w-3.5 h-3.5" aria-hidden />
      {label}
      {count > 0 && (
        <span className="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-primary/15 text-foreground typo-caption tabular-nums">
          {count}
        </span>
      )}
    </span>
  );
}

export function DecisionModeTabs({
  mode,
  onModeChange,
  counts,
}: {
  mode: DecisionMode;
  onModeChange: (m: DecisionMode) => void;
  /** Pending count per mode — the whole point of a decision center is seeing
   *  where the queue is without opening each one. */
  counts: Record<DecisionMode, number>;
}) {
  const { t } = useTranslation();
  const r = t.overview.review;

  return (
    <div className="px-4 pt-3 pb-1 border-b border-primary/10">
      <SegmentedTabs<DecisionMode>
        tabs={[
          { id: 'reviews', ariaLabel: r.mode_reviews, label: <TabLabel icon={ClipboardCheck} label={r.mode_reviews} count={counts.reviews} /> },
          { id: 'backlog', ariaLabel: r.mode_backlog, label: <TabLabel icon={ScanSearch} label={r.mode_backlog} count={counts.backlog} /> },
        ]}
        activeTab={mode}
        onTabChange={onModeChange}
        ariaLabel={r.mode_switch_label}
        layoutId="approvals-mode"
        idPrefix="approvals-mode"
      />
    </div>
  );
}
