import { useEffect, useRef, useState } from "react";

/**
 * Track whether a scrollable element has content above or below the
 * visible viewport. Consumers attach the returned ref to the
 * overflow-y-auto element and render fade gradients conditionally based
 * on `topShadow` / `bottomShadow`.
 *
 * Re-evaluates on scroll AND on size / content change (ResizeObserver on
 * both the scroll container and its first child) so the affordance
 * stays in sync after the content grows or the panel resizes.
 */
export function useScrollShadows<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const [topShadow, setTopShadow] = useState(false);
  const [bottomShadow, setBottomShadow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      // 1-pixel tolerance avoids flicker at the edges from sub-pixel
      // scroll positions on high-DPI displays.
      setTopShadow(scrollTop > 1);
      setBottomShadow(scrollTop + clientHeight < scrollHeight - 1);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  return { ref, topShadow, bottomShadow };
}
