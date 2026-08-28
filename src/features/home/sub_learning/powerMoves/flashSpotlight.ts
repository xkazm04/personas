import { createLogger } from '@/lib/log';
import { createLatestWins } from '@/stores/util/latestWins';

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
const flashes = createLatestWins();
const log = createLogger('powerMoves/flashSpotlight');

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

/**
 * One breadcrumb per way this spotlight can decline to paint. The guided-tour
 * degradation policy is "skip, never strand" — which this already did — plus
 * "instrument every skip", which it did not.
 */
function noteDegradation(reason: string, testId: string): void {
  // Scoped logger, not a raw Sentry breadcrumb: telemetry egress is consent-
  // gated at the boot door and a side-field on a breadcrumb bypasses the
  // record scrubber (census: consent-bypassing-telemetry-import,
  // unscrubbed-telemetry-side-field).
  log.warn(`flashSpotlight skipped: ${reason}`, { testId });
}

/**
 * Reduced motion, from BOTH of the app's signals. There are two: the OS media
 * query, and the in-app Appearance toggle that `themeStore` projects as
 * `<html data-motion="reduce">` (globals.css honours both). Neither reaches
 * this module for free -- the CSS override cannot touch a Web Animations API
 * animation, and `scroll-behavior: auto !important` cannot override an
 * explicit `behavior: 'smooth'` argument. So the two motions this file owns --
 * a smooth scroll and a six-keyframe pulse -- are the two the app's global
 * reduce-motion handling misses, and the check has to be made here.
 */
function prefersReducedMotion(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.getAttribute('data-motion') === 'reduce') {
    return true;
  }
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Poll for `[data-testid="${testId}"]` until present or timed out.
 *
 * `generation` is the caller's `flashes` token. The poll runs for up to 4s, so
 * a superseded call used to keep querying the document every 80ms (~50 wasted
 * queries) for a result nobody would read, and then fired an
 * `anchor-never-mounted` breadcrumb for an anchor it had already abandoned —
 * a degradation signal that says nothing about the app's health. Checking the
 * token inside the tick ends the loop at the first beat after it is superseded
 * and resolves `null` WITHOUT a breadcrumb: being replaced is not a failure.
 */
function waitForTestId(testId: string, generation: number): Promise<Element | null> {
  if (!isSafeTestId(testId)) {
    if (typeof console !== 'undefined') {
      console.warn(
        `[flashSpotlight] rejected unsafe testid; expected /^[a-zA-Z0-9_-]+$/`,
        { received: testId },
      );
    }
    noteDegradation('unsafe-testid', testId);
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const deadline = Date.now() + WAIT_MS;
    const tick = () => {
      // Superseded: stop polling, and stay silent — no one is waiting.
      if (!flashes.isCurrent(generation)) return resolve(null);
      const el = document.querySelector(`[data-testid="${testId}"]`);
      if (el) return resolve(el);
      if (Date.now() > deadline) {
        // A missing anchor is an expected condition, but a SILENT one is how a
        // dead deep link survives: the ring never paints, nothing is logged,
        // and the move is still marked "tried". Record the degradation so a
        // spotlight that stopped resolving is visible rather than merely
        // invisible.
        noteDegradation('anchor-never-mounted', testId);
        return resolve(null);
      }
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
 *
 * Under reduced motion the scroll is instant and the ring is steady — the
 * affordance still marks the anchor, it just stops moving.
 */
export async function flashSpotlight(testId: string): Promise<void> {
  const mine = flashes.next();
  removeActiveFlash();
  const el = await waitForTestId(testId, mine);
  if (!el || !flashes.isCurrent(mine)) return;

  const reduceMotion = prefersReducedMotion();
  el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  // An instant scroll still needs one macrotask for layout to settle before the
  // rect is read; it does not need the smooth-scroll settle window.
  await new Promise((r) => setTimeout(r, reduceMotion ? 0 : SCROLL_SETTLE_MS));
  if (!flashes.isCurrent(mine)) return;

  // Re-query post-scroll: the node may have re-rendered into a new element.
  const live = document.querySelector(`[data-testid="${testId}"]`) ?? el;
  const rect = live.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    noteDegradation('anchor-has-no-box', testId);
    return;
  }

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

  if (reduceMotion) {
    // The steady-ring fallback globals.css already uses for its own spotlights
    // ("prefers-reduced-motion: a steady ring + steady corners, no animation").
    // The affordance still lands -- the anchor is still marked -- without the
    // scale-and-fade pulse.
    window.setTimeout(() => {
      if (activeFlash === ring) removeActiveFlash();
      else ring.remove();
    }, FLASH_MS);
    return;
  }

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
