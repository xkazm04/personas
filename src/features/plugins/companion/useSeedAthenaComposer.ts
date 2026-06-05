import { useCallback } from 'react';
import { useCompanionStore } from './companionStore';

/**
 * Open Athena's chat panel and seed the composer with a pre-composed draft,
 * then wait for the user to finish + send it (`autoSend: false`). For outside
 * surfaces that hand Athena a task template the user must complete — e.g. the
 * Lab "Improve" action seeds an improvement brief (persona + version + weakest
 * measured metric) and lets the user specify what to focus on before sending.
 *
 * Mirrors {@link useForwardToAthena}, but seeds-and-waits instead of firing the
 * turn immediately. Returns a stable `seed(text)` callback.
 */
export function useSeedAthenaComposer(): (text: string) => void {
  return useCallback((text: string) => {
    if (!text.trim()) return;
    const store = useCompanionStore.getState();
    store.setState('open');
    store.setPendingPrompt({ text, autoSend: false });
  }, []);
}
