import { useState, useCallback, useRef } from 'react';

/**
 * Hook for clipboard copy with timed feedback.
 * Returns `{ copied, copy }` where `copied` resets after `timeout` ms.
 */
export function useCopyToClipboard(timeout = 2000) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const copy = useCallback(
    (text: string) => {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), timeout);
      }).catch(() => {});
    },
    [timeout],
  );

  return { copied, copy };
}
