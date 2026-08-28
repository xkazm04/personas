import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flashSpotlight } from '../flashSpotlight';

describe('flashSpotlight', () => {
  it('resolves without throwing when the testid contains selector-breaking characters', async () => {
    // A quote/bracket in the id would previously be interpolated directly
    // into `document.querySelector(`[data-testid="${testId}"]`)` and throw a
    // SyntaxError inside this fire-and-forget async function -- an unhandled
    // rejection nobody awaits or catches. The charset guard must reject it
    // gracefully instead.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(flashSpotlight('bad"id]')).resolves.toBeUndefined();
    warnSpy.mockRestore();
  });

  it('resolves without throwing for an empty testid', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(flashSpotlight('')).resolves.toBeUndefined();
    warnSpy.mockRestore();
  });

  it('stops polling for an anchor a newer call has superseded', async () => {
    // The generation token made a superseded call inert at its RESUME points,
    // but the 80ms poll itself was never cancelled: an abandoned call kept
    // querying the document for the rest of its 4s deadline (~50 wasted
    // queries) and then filed an `anchor-never-mounted` degradation for an
    // anchor nobody was waiting for.
    vi.useFakeTimers();
    document.body.innerHTML = '';
    try {
      const first = flashSpotlight('anchor-alpha');
      await vi.advanceTimersByTimeAsync(200); // a few ticks of the first poll
      const second = flashSpotlight('anchor-beta'); // supersedes the first

      const spy = vi.spyOn(document, 'querySelector');
      await vi.advanceTimersByTimeAsync(1000);
      const alphaQueries = spy.mock.calls.filter((c) => String(c[0]).includes('anchor-alpha'));
      expect(alphaQueries).toHaveLength(0);

      // The live call keeps polling — the guard cancels the abandoned loop only.
      expect(spy.mock.calls.filter((c) => String(c[0]).includes('anchor-beta')).length).toBeGreaterThan(0);

      spy.mockRestore();
      await vi.advanceTimersByTimeAsync(4000);
      await Promise.all([first, second]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('flashSpotlight under reduced motion', () => {
  function mountAnchor(): HTMLElement {
    const el = document.createElement('div');
    el.setAttribute('data-testid', 'anchor-under-test');
    // jsdom gives every element a zero rect; the spotlight skips a box-less
    // anchor, so give this one a real one.
    el.getBoundingClientRect = () => ({ x: 10, y: 20, left: 10, top: 20, width: 100, height: 40, right: 110, bottom: 60, toJSON: () => ({}) }) as DOMRect;
    document.body.appendChild(el);
    return el;
  }

  const ring = () => document.querySelector('[data-testid="power-move-flash"]');

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-motion');
    // jsdom implements neither of these.
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.animate = vi.fn(() => ({ onfinish: null }) as unknown as Animation);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.removeAttribute('data-motion');
    vi.restoreAllMocks();
  });

  it('scrolls smoothly and animates the ring when motion is allowed', async () => {
    mountAnchor();
    const done = flashSpotlight('anchor-under-test');
    await vi.advanceTimersByTimeAsync(400);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(Element.prototype.animate).toHaveBeenCalledTimes(1);
    expect(ring()).not.toBeNull();
    await done;
  });

  it('honours the in-app reduce-motion toggle: instant scroll, steady ring, no animation', async () => {
    // `<html data-motion="reduce">` is what themeStore writes for the
    // Appearance setting. The global CSS override cannot reach a Web
    // Animations API pulse or an explicit `behavior: 'smooth'`, so before this
    // was read here the spotlight animated for a user who asked it not to.
    document.documentElement.setAttribute('data-motion', 'reduce');
    mountAnchor();
    const done = flashSpotlight('anchor-under-test');
    await vi.advanceTimersByTimeAsync(10);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' });
    expect(Element.prototype.animate).not.toHaveBeenCalled();
    expect(ring()).not.toBeNull();
    await done;

    // Steady, then gone — the ring is not left on screen forever.
    await vi.advanceTimersByTimeAsync(2700);
    expect(ring()).toBeNull();
  });

  it('honours the OS media query too', async () => {
    vi.stubGlobal('matchMedia', vi.fn((q: string) => ({
      matches: q.includes('prefers-reduced-motion'),
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    mountAnchor();
    const done = flashSpotlight('anchor-under-test');
    await vi.advanceTimersByTimeAsync(10);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' });
    expect(Element.prototype.animate).not.toHaveBeenCalled();
    await done;
    vi.unstubAllGlobals();
  });
});
