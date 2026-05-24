import { useState, useCallback, useEffect, useRef } from 'react';
import { silentCatch } from "@/lib/silentCatch";

/**
 * Canonical clipboard write — the ONE place `navigator.clipboard.writeText`
 * should live. Use from non-React / module-scope code (where hooks can't run);
 * React components prefer `useCopyToClipboard()` (timed feedback) or the
 * `<CopyButton>` component. Resolves `true` on success, `false` on failure
 * (failures post a Sentry breadcrumb via silentCatch, never throw).
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    silentCatch("copyToClipboard:writeText")(err);
    return false;
  }
}

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
      void copyText(text).then((ok) => {
        if (!ok) return;
        setCopied(true);
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), timeout);
      });
    },
    [timeout],
  );

  return { copied, copy };
}
