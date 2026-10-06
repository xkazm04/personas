/**
 * Folio · the open book of decisions (Alt+W, a footnote mark, a ref link).
 * Two pages on one spread: the verso is the CONTENTS (what waits on you, by
 * footnote mark, with dot leaders to its page) above an INDEX OF WORKS (what
 * runs, per project); the recto is the page itself, the question set as text.
 * ← / → turn the page through the queue (it turns on the gutter), Space sets
 * the page aside for now, Esc or Alt+W closes the book (`useLayer`).
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, type Variants } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { FULLSCREEN_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import type { ProjectColumn } from '../../../useProcessColumns';
import type { WorkItem } from '../../../useWorkforce';
import { FOLIO_COPY as C } from './copy';
import { FolioContents } from './FolioContents';
import { FolioPage } from './FolioPage';
import { FOLIO_EASE } from './marks';
import { Key } from './parts';

interface FolioProps {
  open: boolean;
  items: WorkItem[];
  columns: ProjectColumn[];
  focusId: string | null;
  onFocus: (id: string) => void;
  onClose: () => void;
  onSend: (text: string) => void;
}

export function Folio(props: FolioProps) {
  return <AnimatePresence>{props.open && <Spread {...props} />}</AnimatePresence>;
}

const TURN: Variants = {
  enter: (dir: number) => ({ opacity: 0, rotateY: dir * 16, x: dir * 28 }),
  center: { opacity: 1, rotateY: 0, x: 0 },
  exit: (dir: number) => ({ opacity: 0, rotateY: dir * -10, x: dir * -18 }),
};

function isTyping(el: Element | null): boolean {
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable;
}

function Spread({ items, columns, focusId, onFocus, onClose, onSend }: Omit<FolioProps, 'open'>) {
  const { shouldAnimate } = useMotion();
  const [aside, setAside] = useState<ReadonlySet<string>>(() => new Set());
  const live = useMemo(() => items.filter((i) => !aside.has(i.id)), [items, aside]);
  const [activeId, setActiveId] = useState<string | null>(focusId);
  const [dir, setDir] = useState(1);
  const active = live.find((i) => i.id === activeId) ?? live[0] ?? null;
  const at = active ? live.indexOf(active) : -1;
  const ref = useRef({ live, at });
  ref.current = { live, at };

  const pick = useCallback(
    (id: string) => {
      const { live: l, at: cur } = ref.current;
      setDir(l.findIndex((i) => i.id === id) >= cur ? 1 : -1);
      setActiveId(id);
      onFocus(id);
    },
    [onFocus],
  );
  const turn = useCallback(
    (d: 1 | -1) => {
      const { live: l, at: cur } = ref.current;
      if (l.length < 2) return;
      const next = l[(cur + d + l.length) % l.length]!;
      setDir(d);
      setActiveId(next.id);
      onFocus(next.id);
    },
    [onFocus],
  );

  useAppKeyboard(
    (e) => {
      if (isTyping(document.activeElement) || e.altKey || e.ctrlKey || e.metaKey) return false;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        if (ref.current.live.length < 2) return false;
        e.preventDefault();
        turn(e.key === 'ArrowRight' ? 1 : -1);
        return true;
      }
      if (e.key === ' ') {
        const cur = ref.current.live[ref.current.at];
        if (!cur) return false;
        e.preventDefault();
        setAside((s) => new Set(s).add(cur.id));
        return true;
      }
      return false;
    },
    { priority: FULLSCREEN_LAYER_PRIORITY + 1 },
  );

  const mark = active ? items.indexOf(active) : -1;
  return (
    <div className="r5c-folio-seat">
      <motion.div
        className="r5c-folio"
        role="region"
        aria-label={C.folioNamed}
        data-testid="companion-r5c-folio"
        initial={shouldAnimate ? { opacity: 0, y: 12 } : { opacity: 0 }}
        animate={{ opacity: 1, y: 0 }}
        exit={shouldAnimate ? { opacity: 0, y: 12 } : { opacity: 0 }}
        transition={{ duration: shouldAnimate ? 0.3 : 0, ease: FOLIO_EASE }}
      >
        <FolioContents items={items} live={live} activeId={active?.id ?? null} columns={columns} onPick={pick} />
        <span className="r5c-gutter" aria-hidden />
        <div className="r5c-recto">
          <header className="r5c-recto-head">
            {active && <span className="typo-caption italic">{C.pageOf(at + 1, live.length)}</span>}
            <span className="flex-1" />
            <Button variant="ghost" size="icon-sm" onClick={() => turn(-1)} disabled={live.length < 2} aria-label={C.previous} aria-keyshortcuts="ArrowLeft">
              <ChevronLeft className="w-4 h-4" aria-hidden />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => turn(1)} disabled={live.length < 2} aria-label={C.next} aria-keyshortcuts="ArrowRight">
              <ChevronRight className="w-4 h-4" aria-hidden />
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose} aria-keyshortcuts="Escape" data-testid="companion-r5c-folio-close">
              {C.close} <Key>{C.keyFold}</Key>
            </Button>
          </header>
          <div className="r5c-recto-stage">
            <AnimatePresence mode="wait" custom={dir} initial={false}>
              <motion.div
                key={active?.id ?? 'blank'}
                custom={dir}
                variants={shouldAnimate ? TURN : undefined}
                initial={shouldAnimate ? 'enter' : false}
                animate="center"
                exit={shouldAnimate ? 'exit' : undefined}
                transition={{ duration: shouldAnimate ? 0.32 : 0, ease: FOLIO_EASE }}
                className="r5c-recto-body scrollbar-thin"
              >
                {active ? (
                  <FolioPage item={active} mark={mark} onSend={onSend} />
                ) : (
                  <div className="r5c-blank">
                    <p className="typo-heading-lg italic text-foreground">{C.nothingWaitsTitle}</p>
                    <p className="typo-body italic">{C.nothingWaitsLine}</p>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
        <footer className="r5c-colophon typo-caption">
          <span><Key>1–9</Key> {C.choose}</span>
          <span><Key>0</Key> {C.askNote}</span>
          <span><Key>Enter</Key> {C.takeNote}</span>
          <span><Key>←</Key><Key>→</Key> {C.turnPage}</span>
          <span><Key>Space</Key> {C.aside}</span>
          <span><Key>{C.keyFold}</Key> {C.close}</span>
        </footer>
      </motion.div>
    </div>
  );
}
