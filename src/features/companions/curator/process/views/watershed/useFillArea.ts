import { useLayoutEffect, type RefObject } from 'react';

/**
 * Make the stage fill the content area under the page header, edge to edge.
 *
 * The page body is a scroller whose inner box is `min-h-full` with padding, so `h-full` on a view
 * resolves to auto and a map would get no height of its own. This measures instead: the stage
 * takes the scroller's height and cancels the inner box's padding with negative margins, so the
 * figure meets the header and the window's edges the way the prototype's stage did. It follows
 * the scroller with a ResizeObserver; no layout reads happen anywhere else.
 */
export function useFillArea(root: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    let scroller: HTMLElement | null = el.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    if (!scroller) return;
    const pad = scroller.firstElementChild instanceof HTMLElement && scroller.firstElementChild.contains(el) ? scroller.firstElementChild : null;
    const fit = () => {
      const cs = pad ? getComputedStyle(pad) : null;
      const [t, r, b, l] = cs ? [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft] : ['0px', '0px', '0px', '0px'];
      el.style.margin = `-${t} -${r} -${b} -${l}`;
      el.style.height = `${scroller!.clientHeight}px`;
      el.style.width = `calc(100% + ${l} + ${r})`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(scroller);
    return () => ro.disconnect();
  }, [root]);
}
