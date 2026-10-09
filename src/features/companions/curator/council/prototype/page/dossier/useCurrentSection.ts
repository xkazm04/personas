// PROTOTYPE ROUND (spark council-readout). Which Dossier section the reader is
// in: the last one whose top has crossed the upper quarter of the scroller.
import { useCallback, useEffect, useState, type RefObject } from 'react';

import { sectionId } from './format';

export function useCurrentSection(scroller: RefObject<HTMLElement | null>, keys: string[]) {
  const [current, setCurrent] = useState<string | null>(keys[0] ?? null);
  const signature = keys.join('|');

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const line = el.getBoundingClientRect().top + el.clientHeight * 0.25;
      let found: string | null = keys[0] ?? null;
      for (const key of keys) {
        const node = document.getElementById(sectionId(key));
        if (node && node.getBoundingClientRect().top <= line) found = key;
      }
      // At the very bottom, the last section is the current one even if short.
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) found = keys[keys.length - 1] ?? found;
      setCurrent(found);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
    // `signature` stands for `keys`: a new array with the same entries is the same contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scroller, signature]);

  const jump = useCallback((key: string) => {
    const node = document.getElementById(sectionId(key));
    node?.scrollIntoView({ block: 'start' });
    setCurrent(key);
  }, []);

  return { current, jump };
}
