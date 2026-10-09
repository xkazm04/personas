// One context so the chart's LAYOUT is a file that arranges blocks, not a file
// that forwards thirty props. Same shape as sub_goals/goalDetail/context.tsx.
import { createContext, useContext, type ReactNode } from 'react';

import type { SoundingsModel } from './useSoundings';

const SoundingsContext = createContext<SoundingsModel | null>(null);

export function SoundingsProvider({ model, children }: { model: SoundingsModel; children: ReactNode }) {
  return <SoundingsContext.Provider value={model}>{children}</SoundingsContext.Provider>;
}

/**
 * Throws rather than returning null. A block rendered outside the provider is a
 * wiring mistake with no sensible fallback, and a silent `?.` would turn it into
 * a blank region that looks like missing data.
 */
export function useSoundingsModel(): SoundingsModel {
  const v = useContext(SoundingsContext);
  if (!v) throw new Error('useSoundingsModel must be used inside <SoundingsProvider>');
  return v;
}
