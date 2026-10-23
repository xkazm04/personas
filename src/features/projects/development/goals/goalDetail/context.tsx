// One context so a LAYOUT is a file that arranges blocks, not a file that
// forwards thirty props.
//
// The blocks in `blocks/` each read what they need from here. That is what makes
// three layouts cheap: a variant imports the blocks it wants and decides where
// they sit, and none of them knows how the data arrived.
import { createContext, useContext, type ReactNode } from 'react';

import type { GoalDetailModel } from './useGoalDetail';

const GoalDetailContext = createContext<GoalDetailModel | null>(null);

export function GoalDetailProvider({ model, children }: { model: GoalDetailModel; children: ReactNode }) {
  return <GoalDetailContext.Provider value={model}>{children}</GoalDetailContext.Provider>;
}

/**
 * Throws rather than returning null. A block rendered outside the provider is a
 * wiring mistake with no sensible fallback, and a silent `?.` would turn it into
 * a blank section that looks like missing data.
 */
export function useGoalDetailModel(): GoalDetailModel {
  const v = useContext(GoalDetailContext);
  if (!v) throw new Error('useGoalDetailModel must be used inside <GoalDetailProvider>');
  return v;
}
