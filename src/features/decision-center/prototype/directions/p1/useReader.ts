/**
 * Reading chrome for the long-form reader, per the long-form-reading-surface
 * standard: ONE heading-id assigner (this walk — the contents list and the
 * rendered headings cannot disagree, because the list is read back from the
 * ids this function wrote) and ONE chrome offset (`--p1-chrome-offset`, used
 * by `scroll-margin-top` in p1.css and by the active-heading probe here).
 */
import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react';

export interface ReaderHeading { id: string; text: string; level: number }

function chromeOffset(el: HTMLElement): number {
  const raw = getComputedStyle(el).getPropertyValue('--p1-chrome-offset').trim();
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return raw.endsWith('rem') ? parseFloat(raw) * rem : parseFloat(raw) || 0;
}

export function useReader(scrollRef: RefObject<HTMLElement | null>, docKey: string) {
  const [headings, setHeadings] = useState<ReaderHeading[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (!root) { setHeadings([]); return; }
    const found: ReaderHeading[] = [];
    root.querySelectorAll<HTMLElement>('.p1-doc h1, .p1-doc h2, .p1-doc h3').forEach((h, i) => {
      h.id = `p1-h-${docKey.replace(/[^a-z0-9]/gi, '')}-${i}`;
      found.push({ id: h.id, text: h.textContent ?? '', level: Number(h.tagName.slice(1)) });
    });
    setHeadings(found);
    setActive(found[0]?.id ?? null);
    setProgress(0);
    root.scrollTop = 0;
  }, [scrollRef, docKey]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const onScroll = () => {
      const max = root.scrollHeight - root.clientHeight;
      setProgress(max > 0 ? root.scrollTop / max : 1);
      const line = root.getBoundingClientRect().top + chromeOffset(root) + 8;
      let current: string | null = headings[0]?.id ?? null;
      for (const h of headings) {
        const el = document.getElementById(h.id);
        if (el && el.getBoundingClientRect().top <= line) current = h.id;
      }
      setActive(current);
    };
    onScroll();
    root.addEventListener('scroll', onScroll, { passive: true });
    // A document that grows after mount (an auto-height frame, late images) re-reads progress.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onScroll);
    if (root.firstElementChild) observer?.observe(root.firstElementChild);
    return () => {
      root.removeEventListener('scroll', onScroll);
      observer?.disconnect();
    };
  }, [scrollRef, headings]);

  const jump = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);

  return { headings, active, progress, jump };
}
