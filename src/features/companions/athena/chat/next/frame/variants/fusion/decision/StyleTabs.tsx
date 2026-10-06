/** Fusion · the decision-surface style switch for the round-6 review (see `style.ts`). */

import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { DECISION_STYLES, useDecisionStyle } from './style';

export function DecisionStyleTabs() {
  const style = useDecisionStyle((s) => s.style);
  const set = useDecisionStyle((s) => s.set);
  return (
    <div className="fu-style-tabs rounded-full bg-background/90 backdrop-blur border border-foreground/15 shadow-elevation-3 p-1">
      <SegmentedTabs
        tabs={DECISION_STYLES}
        activeTab={style}
        onTabChange={set}
        size="sm"
        fullWidth={false}
        ariaLabel="Decision style"
        layoutId="fusion-decision-style"
        idPrefix="fu-dstyle"
      />
    </div>
  );
}
