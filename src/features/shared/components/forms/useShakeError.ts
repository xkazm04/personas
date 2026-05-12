import { useCallback, useRef } from 'react';

/**
 * Returns a ref to attach to an element and a `trigger()` function that adds
 * the `.animate-shake-error` class, then removes it once the animation ends
 * so the shake can be re-triggered on the next validation attempt.
 */
export function useShakeError<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);

  const trigger = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Remove first so re-triggering works even if the class is already present
    el.classList.remove('animate-shake-error');
    // Force reflow so the browser treats the re-add as a new animation
    void el.offsetWidth;
    el.classList.add('animate-shake-error');

    const onEnd = () => {
      el.classList.remove('animate-shake-error');
      el.removeEventListener('animationend', onEnd);
    };
    el.addEventListener('animationend', onEnd, { once: true });
  }, []);

  return { ref, trigger } as const;
}
