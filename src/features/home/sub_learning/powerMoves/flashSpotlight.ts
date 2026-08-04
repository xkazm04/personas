const POLL_MS = 80;
const WAIT_MS = 4000;
const SCROLL_SETTLE_MS = 350;
const PADDING = 8;
const FLASH_MS = 2600;

let activeFlash: HTMLDivElement | null = null;

/**
 * Bumped by every call. `waitForTestId` polls for up to 4s and the scroll
 * settle adds another 350ms, so a second "Try it" can easily start while the
 * first is still waiting. Without this token the older call would wake up
 * afterwards and paint its ring on the previous move's anchor — over a surface
 * the user has already navigated away from. Each call captures its number and
 * abandons at every resume point if a newer one has started.
 */
let generation = 0;

function removeActiveFlash() {
  activeFlash?.remove();
  activeFlash = null;
}

// Mirrors tourSlice's TOUR_TEST_ID_PATTERN / useTrackedElementRect's local
// copy -- kept local so this file carries no dependency on the onboarding
// store slice. Defense-in-depth: every known caller (`registry.ts`) already
// supplies a hand-audited literal, but a stray quote/bracket must never
// reach querySelector and throw a SyntaxError inside this fire-and-forget
// async function, whose rejection nobody awaits or catches.
const TESTID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function isSafeTestId(id: string): boolean {
  return TESTID_PATTERN.test(id);
}

/** Poll for `[data-testid="${testId}"]` until present or timed out. */
function waitForTestId(testId: string): Promise<Element | null> {
  if (!isSafeTestId(testId)) {
    if (typeof console !== 'undefined') {
      console.warn(
        `[flashSpotlight] rejected unsafe testid; expected /^[a-zA-Z0-9_-]+$/`,
        { received: testId },
      );
    }
    return Promise.resolve(null);
  }
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
  const mine = ++generation;
  removeActiveFlash();
  const el = await waitForTestId(testId);
  if (!el || mine !== generation) return;

  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await new Promise((r) => setTimeout(r, SCROLL_SETTLE_MS));
  if (mine !== generation) return;

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
