import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * Provides transient "saved" visibility state for inline micro-feedback.
 * Call `trigger()` after a successful save; `visible` stays true for `holdMs`
 * then reverts, letting a CSS opacity transition handle the fade-out.
 */
export function useSaveFeedback(holdMs = 1200) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trigger = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(true);
    timerRef.current = setTimeout(() => setVisible(false), holdMs);
  }, [holdMs]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { visible, trigger } as const;
}
