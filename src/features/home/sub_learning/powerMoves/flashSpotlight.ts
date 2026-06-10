const POLL_MS = 80;
const WAIT_MS = 4000;
const SCROLL_SETTLE_MS = 350;
const PADDING = 8;
const FLASH_MS = 2600;

let activeFlash: HTMLDivElement | null = null;

function removeActiveFlash() {
  activeFlash?.remove();
  activeFlash = null;
}

/** Poll for `[data-testid="${testId}"]` until present or timed out. */
function waitForTestId(testId: string): Promise<Element | null> {
  return new Promise((resolve) => {
    const deadline = Date.now() + WAIT_MS;
    const tick = () => {
      const el = document.querySelector(`[data-testid="${testId}"]`);
      if (el) return resolve(el);
      if (Date.now() > deadline) return resolve(null);
      setTimeout(tick, POLL_MS);
    };
    tick();
  });
}

/**
 * One-shot landing affordance for power-move deep links: waits for the target
 * to mount (the deep link usually just navigated), scrolls it into view, then
 * pulses a primary-colored ring over its rect for ~2.5s and removes itself.
 *
 * Deliberately imperative (plain DOM node, no React mount point or store
 * state) so it works on any route without a global overlay component. It does
 * not track scroll/resize during the pulse — the target was just centered, and
 * the ring is pointer-events-none, so a stale rect costs nothing. Tours keep
 * the dimming `TourSpotlight`; this is the lightweight non-dimming cousin.
 */
export async function flashSpotlight(testId: string): Promise<void> {
  removeActiveFlash();
  const el = await waitForTestId(testId);
  if (!el) return;

  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await new Promise((r) => setTimeout(r, SCROLL_SETTLE_MS));

  // Re-query post-scroll: the node may have re-rendered into a new element.
  const live = document.querySelector(`[data-testid="${testId}"]`) ?? el;
  const rect = live.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;

  const ring = document.createElement('div');
  ring.setAttribute('data-testid', 'power-move-flash');
  ring.setAttribute('aria-hidden', 'true');
  Object.assign(ring.style, {
    position: 'fixed',
    left: `${rect.left - PADDING}px`,
    top: `${rect.top - PADDING}px`,
    width: `${rect.width + PADDING * 2}px`,
    height: `${rect.height + PADDING * 2}px`,
    border: '2px solid var(--color-primary)',
    borderRadius: '12px',
    boxShadow: '0 0 18px 2px color-mix(in srgb, var(--color-primary) 45%, transparent)',
    pointerEvents: 'none',
    zIndex: '9998',
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(ring);
  activeFlash = ring;

  const anim = ring.animate(
    [
      { opacity: 0, transform: 'scale(1.03)' },
      { opacity: 1, transform: 'scale(1)', offset: 0.15 },
      { opacity: 1, transform: 'scale(1)', offset: 0.4 },
      { opacity: 0.45, transform: 'scale(1)', offset: 0.55 },
      { opacity: 1, transform: 'scale(1)', offset: 0.7 },
      { opacity: 0, transform: 'scale(1.02)' },
    ],
    { duration: FLASH_MS, easing: 'ease-in-out' },
  );
  anim.onfinish = () => {
    if (activeFlash === ring) removeActiveFlash();
    else ring.remove();
  };
}
