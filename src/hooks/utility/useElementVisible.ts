import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Returns a ref and a boolean indicating whether the element is currently
 * visible in the viewport (via IntersectionObserver).
 *
 * Unlike LazyChart (one-shot), this hook continuously tracks visibility
 * so callers can gate polling / event listeners on it.
 */
export function useElementVisible<T extends HTMLElement = HTMLDivElement>(): [
  RefObject<T | null>,
  boolean,
] {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setVisible(entry?.isIntersecting ?? false);
      },
      { threshold: 0 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, visible];
}
