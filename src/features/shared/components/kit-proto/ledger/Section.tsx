/**
 * Section (Ledger kit): eyebrow + title + count + status + actions over ONE head
 * rule that glows from the theme primary and fades into the hairline. No box, no
 * surface, no padding around the body. The head is sticky and gains its backing
 * only while it is actually pinned (at rest it is just a rule).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === 'auto' || oy === 'scroll') return p;
  }
  return null;
}

/** True while the head is pinned to the top of its scroller (the variant's `is-stuck`). */
function useStuck(head: React.RefObject<HTMLElement | null>): boolean {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = head.current;
    const scroller = el ? scrollParent(el) : null;
    if (!el || !scroller) return;
    let queued = false;
    const measure = () => {
      queued = false;
      const top = scroller.getBoundingClientRect().top;
      const section = el.parentElement?.getBoundingClientRect().top ?? top;
      setStuck(el.getBoundingClientRect().top - top < 1 && section - top < -1);
    };
    const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(measure); } };
    measure();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [head]);
  return stuck;
}

export function Section({ id, eyebrow, title, count, status, actions, muted, children, 'data-testid': testId }: {
  id?: string;
  eyebrow?: ReactNode;
  title: ReactNode;
  count?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  muted?: boolean;
  children?: ReactNode;
  'data-testid'?: string;
}) {
  const head = useRef<HTMLElement>(null);
  const stuck = useStuck(head);
  return (
    <section id={id} className={`sec${muted ? ' is-muted' : ''}`} data-testid={testId}>
      <header ref={head} className={`sec-head${stuck ? ' is-stuck' : ''}`} data-role="lg-sec-head">
        <div className="sec-titles">
          {eyebrow != null && <span className="sec-eyebrow typo-eyebrow" data-role="lg-eyebrow">{eyebrow}</span>}
          <div className="sec-line">
            <h2 className="sec-title typo-section-title" data-role="lg-sec-title">{title}</h2>
            {count != null && <span className="sec-count typo-data k-regular" data-role="lg-sec-count">{count}</span>}
          </div>
        </div>
        {status != null && <div className="sec-status typo-caption">{status}</div>}
        {actions != null && <div className="sec-actions">{actions}</div>}
      </header>
      <div className="sec-body">{children}</div>
    </section>
  );
}
