import { useState, useCallback, useEffect, useRef } from 'react';
import { silentCatch } from "@/lib/silentCatch";

/**
 * Hook for clipboard copy with timed feedback.
 * Returns `{ copied, copy }` where `copied` resets after `timeout` ms.
 * Pending reset timers are cleared on unmount so a fast unmount-after-copy
 * can't fire `setCopied(false)` on an unmounted component.
 */
export function useCopyToClipboard(timeout = 2000) {
  const [copied, setCopied] = useState(false);
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
    (text: string) => {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), timeout);
      }).catch(silentCatch("copyToClipboard:writeText"));
    },
    [timeout],
  );

  return { copied, copy };
}
