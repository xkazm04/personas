import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from './errorText';

export interface Region<T> {
  data: T;
  /** True only until this region's FIRST answer; a refresh never blanks rendered data (law 1). */
  loading: boolean;
  error?: string;
  reload: () => void;
}

/**
 * One independently loading region of the page (loading pattern v2, law 6):
 * its own fetch, flag and error. `key` re-runs the fetch; a stale answer from
 * an earlier key is dropped. `fetcher` returning null means "nothing to ask".
 */
export function useRegion<T>(context: string, key: string, initial: T, fetcher: () => Promise<T> | null): Region<T> {
  const [state, setState] = useState<{ data: T; loading: boolean; error?: string }>({ data: initial, loading: true });
  const [tick, setTick] = useState(0);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;

  useEffect(() => {
    let alive = true;
    const pending = fetchRef.current();
    if (!pending) {
      setState({ data: initial, loading: false });
      return;
    }
    void (async () => {
      try {
        const data = await pending;
        if (alive) setState({ data, loading: false });
      } catch (err) {
        // errorText logs through silentCatch and returns the inline line.
        const error = errorText(context, err);
        if (alive) setState((s) => ({ ...s, loading: false, error }));
      }
    })();
    return () => { alive = false; };
    // `initial` is a constant per call site; the fetch re-runs on key or reload only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, key, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...state, reload };
}
