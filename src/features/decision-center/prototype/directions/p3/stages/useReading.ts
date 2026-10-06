/**
 * Reading chrome state for the reading room: scroll progress and the heading
 * the reader is in. ONE chrome offset (`READER_CHROME_OFFSET`) is used for the
 * heading scroll-margin, the jump target and the "current heading" line, so a
 * contents jump lands exactly where the active marker says it is.
 */
import { useCallback, useEffect, useState, type RefObject } from 'react';
import type { Heading } from '../model';

export const READER_CHROME_OFFSET = 24;

export function useReading(bodyRef: RefObject<HTMLDivElement | null>, headings: Heading[], key: string) {
  const [progress, setProgress] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(headings[0]?.id ?? null);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => {
      const max = el.scrollHeight - el.clientHeight;
      setProgress(max <= 0 ? 1 : el.scrollTop / max);
      let current: string | null = headings[0]?.id ?? null;
      for (const h of headings) {
        const node = el.querySelector<HTMLElement>(`#${CSS.escape(h.id)}`);
        if (node && node.offsetTop - READER_CHROME_OFFSET <= el.scrollTop + 1) current = h.id;
      }
      setActiveId(current);
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    // Content settles after mount (markdown layout, a frame's fixed height, the
    // walk transition), so the bar re-measures whenever the page changes size.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => { el.removeEventListener('scroll', measure); ro.disconnect(); };
  }, [bodyRef, headings, key]);

  const jumpTo = useCallback((id: string) => {
    const el = bodyRef.current;
    const node = el?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    if (el && node) el.scrollTo({ top: node.offsetTop - READER_CHROME_OFFSET, behavior: 'smooth' });
  }, [bodyRef]);

  return { progress, activeId, jumpTo };
}
