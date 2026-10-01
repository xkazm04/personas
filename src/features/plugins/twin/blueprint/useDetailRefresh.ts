/**
 * When the Twin Detail page re-reads its blueprint (spark
 * twin-portable-blueprint): the engine finished something for this twin in the
 * background (`twin-setup-updated`), a writing sample was analysed
 * (`twin-sample-updated`), or the experience overlay closed over the page,
 * which is where every edit to the twin happens. Returns a key that changes on
 * each, for `useTwinBlueprint`'s `refreshKey`.
 *
 * Both streams attach through `createSingletonListener`, which buffers what
 * arrives before a subscriber registers (golden path snapshot-plus-stream).
 * The page reads at once, so it paints without waiting on the attach, and once
 * BOTH listeners are confirmed it reads again: an event the engine emitted
 * between the first read and the attach is then covered by a read that
 * happened after it, and nothing between the two is lost.
 */
import { useCallback, useEffect, useReducer, useRef } from 'react';

import { createSingletonListener } from '@/hooks/realtime/createSingletonListener';
import type { SetupUpdatedEvent } from '@/lib/bindings/SetupUpdatedEvent';
import type { TwinSampleUpdatedEvent } from '@/lib/bindings/TwinSampleUpdatedEvent';
import { EventName } from '@/lib/eventRegistry';

import { useTwinExperienceRequest } from '../experience/launcher';

const useSetupUpdated = createSingletonListener<SetupUpdatedEvent>(EventName.TWIN_SETUP_UPDATED);
const useSampleUpdated = createSingletonListener<TwinSampleUpdatedEvent>(EventName.TWIN_SAMPLE_UPDATED);

export function useDetailRefresh(twinId: string | null): number {
  const [key, bump] = useReducer((n: number) => n + 1, 0);

  const onEngine = useCallback(
    (payload: SetupUpdatedEvent | TwinSampleUpdatedEvent) => {
      if (payload.twinId === twinId) bump();
    },
    [twinId],
  );
  const setupAttached = useSetupUpdated(onEngine);
  const sampleAttached = useSampleUpdated(onEngine);
  const attached = setupAttached && sampleAttached;

  // The read after the attach: closes the window the first read left open.
  useEffect(() => {
    if (attached) bump();
  }, [attached]);

  const request = useTwinExperienceRequest();
  const wasOpen = useRef(request !== null);
  useEffect(() => {
    if (wasOpen.current && request === null) bump();
    wasOpen.current = request !== null;
  }, [request]);

  return key;
}
