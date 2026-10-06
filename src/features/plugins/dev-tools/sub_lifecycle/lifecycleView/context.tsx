// One context so a LAYOUT is a file that arranges blocks, not a file that
// forwards twenty props. Same shape as `teams/sub_goals/goalDetail/context.tsx`,
// which is the house pattern for a multi-variant surface.
import { createContext, useContext, type ReactNode } from 'react';

import type { LifecycleViewModel } from './useLifecycleView';

const LifecycleViewContext = createContext<LifecycleViewModel | null>(null);

export function LifecycleViewProvider({ model, children }: { model: LifecycleViewModel; children: ReactNode }) {
  return <LifecycleViewContext.Provider value={model}>{children}</LifecycleViewContext.Provider>;
}

/**
 * Throws rather than returning null. A block rendered outside the provider is a
 * wiring mistake with no sensible fallback, and a silent `?.` would turn it into
 * a blank section that looks like missing data.
 */
export function useLifecycleViewModel(): LifecycleViewModel {
  const v = useContext(LifecycleViewContext);
  if (!v) throw new Error('useLifecycleViewModel must be used inside <LifecycleViewProvider>');
  return v;
}
