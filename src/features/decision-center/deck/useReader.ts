/**
 * Reading position for the report reader: progress through the article body
 * and the current section, by the reading-BAND rule — the current section is
 * the topmost heading inside a band that starts just below the chrome and
 * ends well above the fold; when no heading is in the band the previous
 * answer stands (it does not flicker or clear).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { READER_CHROME_OFFSET, stampHeadingIds, type DocHeading } from './readerDocument';

const BAND_RATIO = 0.35;

/**
 * A heading's offset inside the scroll box, in LAYOUT px. Not
 * getBoundingClientRect: the deck morphs and slides (CSS transforms), and a
 * transformed rect would put every heading in the wrong place mid-animation.
 */
function topWithin(el: HTMLElement, box: HTMLElement): number {
  let y = 0;
  let n: HTMLElement | null = el;
  while (n && n !== box) {
    y += n.offsetTop;
    n = n.offsetParent as HTMLElement | null;
  }
  return y;
}

export function useReader(headings: DocHeading[], contentKey: string) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string | null>(headings[0]?.id ?? null);
  const [progress, setProgress] = useState(0);

  useLayoutEffect(() => {
    if (articleRef.current) stampHeadingIds(articleRef.current, headings);
  }, [headings, contentKey]);

  const measure = useCallback(() => {
    const box = scrollRef.current;
    if (!box) return;
    const span = box.scrollHeight - box.clientHeight;
    setProgress(span > 0 ? Math.min(1, box.scrollTop / span) : 1);
    const top = box.scrollTop + READER_CHROME_OFFSET;
    const bottom = top + box.clientHeight * BAND_RATIO;
    let hit: string | null = null;
    let lastAbove: string | null = null;
    for (const h of headings) {
      const el = document.getElementById(h.id);
      if (!el) continue;
      const y = topWithin(el, box);
      if (y >= top - 1 && y <= bottom) { hit = h.id; break; }
      if (y < top) lastAbove = h.id;
    }
    const next = hit ?? lastAbove;
    if (next) setActive(next);
  }, [headings]);

  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    measure();
    box.addEventListener('scroll', measure, { passive: true });
    // Late layout (an HTML frame sizing itself, fonts) changes the scroll span without a scroll.
    const ro = new ResizeObserver(measure);
    if (box.lastElementChild) ro.observe(box.lastElementChild);
    return () => {
      box.removeEventListener('scroll', measure);
      ro.disconnect();
    };
  }, [measure, contentKey]);

  const jump = useCallback((id: string) => {
    const box = scrollRef.current;
    const el = document.getElementById(id);
    if (!box || !el) return;
    const y = topWithin(el, box) - READER_CHROME_OFFSET - 8;
    box.scrollTo({ top: y, behavior: 'smooth' });
    setActive(id);
  }, []);

  return { scrollRef, articleRef, active, progress, jump };
}

export type ReaderState = ReturnType<typeof useReader>;
