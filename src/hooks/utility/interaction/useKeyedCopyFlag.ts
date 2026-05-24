import { useState, useCallback, useEffect, useRef } from 'react';
import { copyText } from './useCopyToClipboard';

/**
 * Keyed variant of useCopyToClipboard for list/table UIs that need to show
 * "copied" feedback on a specific row/cell rather than a single button.
 *
 * Returns `{ copiedKey, copy }` where `copiedKey` is the key passed to the
 * most recent successful copy (or `null`). After `timeout` ms, `copiedKey`
 * resets to `null`. Pending reset timers are cleared on unmount, so a fast
 * unmount-after-copy can't fire setState on an unmounted component.
 *
 * @example
 *   const { copiedKey, copy } = useKeyedCopyFlag<string>();
 *   ...
 *   <button onClick={() => copy(row.id, row.url)}>
 *     {copiedKey === row.id ? <Check /> : <Copy />}
 *   </button>
 */
export function useKeyedCopyFlag<K = string>(timeout = 2000) {
  const [copiedKey, setCopiedKey] = useState<K | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
    };
  }, []);

  const copy = useCallback(
    (key: K, text: string) => {
      void copyText(text).then((ok) => {
        if (!ok) return;
        setCopiedKey(key);
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopiedKey(null), timeout);
      });
    },
    [timeout],
  );

  return { copiedKey, copy };
}
