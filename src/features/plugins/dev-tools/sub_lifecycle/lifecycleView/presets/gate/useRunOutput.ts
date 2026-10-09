/**
 * One run's stored output, read when the run viewer opens it and kept by run
 * id for the session: a run is append-only, so its output never changes and a
 * second open paints at once. A failure is said inline in the viewer, with a
 * retry; it is not cached.
 */
import { useCallback, useEffect, useState } from 'react';

import { getLifecycleRunOutput } from '@/api/devTools/lifecycle';
import { createModuleCache } from '@/hooks/utility/data/useModuleSubscription';
import { resolveError } from '@/lib/errors/errorRegistry';
import { silentCatch } from '@/lib/silentCatch';

/** `null` is a real answer (nothing kept), so the cache stores it boxed. */
interface Kept { text: string | null }

// Runs opened this session; each holds at most 16 KiB, so the cap bounds the memory too.
const outputs = createModuleCache<string, Kept>({ maxSize: 48 });

export type RunOutputState =
  | { status: 'loading' }
  | { status: 'failed'; error: string }
  | { status: 'ready'; text: string | null };

export function useRunOutput(projectId: string | null, runId: string | null): { state: RunOutputState; retry: () => void } {
  const key = projectId && runId ? `${projectId}:${runId}` : null;
  const warm = key ? outputs.get(key) : undefined;
  const [state, setState] = useState<RunOutputState>(warm ? { status: 'ready', text: warm.text } : { status: 'loading' });
  const [gen, setGen] = useState(0);

  useEffect(() => {
    if (!key || !projectId || !runId) return;
    const cached = outputs.get(key);
    if (cached) {
      setState({ status: 'ready', text: cached.text });
      return;
    }
    let live = true;
    setState({ status: 'loading' });
    // Through a resolved promise, so even a synchronous throw lands in the catch as an inline failure.
    Promise.resolve()
      .then(() => getLifecycleRunOutput(projectId, runId))
      .then((text) => {
        outputs.set(key, { text });
        if (live) setState({ status: 'ready', text });
      })
      .catch((err: unknown) => {
        silentCatch('lifecycle:getLifecycleRunOutput')(err);
        if (live) setState({ status: 'failed', error: resolveError(err instanceof Error ? err.message : String(err)).message });
      });
    return () => { live = false; };
  }, [key, projectId, runId, gen]);

  const retry = useCallback(() => setGen((g) => g + 1), []);
  return { state, retry };
}

/** Test-only: forget every kept output. */
export function __resetRunOutputsForTests(): void {
  outputs.clear();
}
