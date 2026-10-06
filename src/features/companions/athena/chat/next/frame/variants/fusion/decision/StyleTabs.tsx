/**
 * Fusion · the decision-surface style switch for the round-6 review (see
 * `style.ts`). The strip and the region it swaps are declared together: the
 * stage content renders inside this component's `role="tabpanel"`, at the id
 * every tab's `aria-controls` names (`SegmentedTabs` derives both from
 * `idPrefix`), so the relationship is not only visual.
 */

import type { ReactNode } from 'react';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { DECISION_STYLES, useDecisionStyle } from './style';

const PREFIX = 'fu-dstyle';

export function DecisionStyleTabs({ children }: { children: ReactNode }) {
  const style = useDecisionStyle((s) => s.style);
  const set = useDecisionStyle((s) => s.set);
  return (
    <>
      <div className="fu-style-tabs rounded-full bg-background/90 backdrop-blur border border-foreground/15 shadow-elevation-3 p-1">
        <SegmentedTabs
          tabs={DECISION_STYLES}
          activeTab={style}
          onTabChange={set}
          size="sm"
          fullWidth={false}
          ariaLabel="Decision style"
          layoutId="fusion-decision-style"
          idPrefix={PREFIX}
        />
      </div>
      <div role="tabpanel" id={`${PREFIX}-panel-${style}`} aria-labelledby={`${PREFIX}-tab-${style}`} className="contents">
        {children}
      </div>
    </>
  );
}
