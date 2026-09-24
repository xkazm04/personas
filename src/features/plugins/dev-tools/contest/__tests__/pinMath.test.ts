import { describe, expect, it } from 'vitest';

import { fitScale, pinFromClick, pinToPoint, readScrollReport } from '../model/pinMath';

describe('pinMath', () => {
  it('fits the design width into the box, never enlarging', () => {
    expect(fitScale(640, 1280)).toBe(0.5);
    expect(fitScale(3000, 1280)).toBe(1);
    expect(fitScale(0, 1920)).toBe(0);
  });

  it('reads only well-formed scroll reports', () => {
    expect(readScrollReport({ type: 'contest-preview-scroll', scrollX: 0, scrollY: 400, docW: 1280, docH: 3200 })).toEqual({
      scrollX: 0,
      scrollY: 400,
      docW: 1280,
      docH: 3200,
    });
    expect(readScrollReport({ type: 'other', scrollX: 0, scrollY: 0, docW: 1, docH: 1 })).toBeNull();
    expect(readScrollReport({ type: 'contest-preview-scroll', scrollX: '0', scrollY: 0, docW: 1, docH: 1 })).toBeNull();
    expect(readScrollReport({ type: 'contest-preview-scroll', scrollX: 0, scrollY: 0, docW: 0, docH: 1 })).toBeNull();
    expect(readScrollReport('contest-preview-scroll')).toBeNull();
  });

  it('places a click in DOCUMENT coordinates using the reported scroll', () => {
    // Box shows the 1280x800 viewport at half scale; click at the box centre.
    const scroll = { scrollX: 0, scrollY: 1600, docW: 1280, docH: 3200 };
    const pin = pinFromClick(320, 200, 0.5, 1280, scroll, 'hero');
    // viewport (640, 400) + scroll (0, 1600) = doc (640, 2000) of 1280x3200
    expect(pin).toEqual({ xPct: 50, yPct: 62.5, width: 1280, height: 800, note: 'hero' });
  });

  it('falls back to viewport coordinates without a report', () => {
    const pin = pinFromClick(320, 200, 0.5, 1280, null);
    expect(pin).toMatchObject({ xPct: 50, yPct: 50, width: 1280, height: 800 });
  });

  it('clamps clicks to the viewport and rounds to one decimal', () => {
    const pin = pinFromClick(10_000, -5, 1, 1920, null);
    expect(pin).toMatchObject({ xPct: 100, yPct: 0, width: 1920, height: 1080 });
    expect(pinFromClick(1, 1, 1, 1280, null).xPct).toBe(0.1);
  });

  it('round-trips a pin back to the point it was placed at', () => {
    const scroll = { scrollX: 0, scrollY: 1600, docW: 1280, docH: 3200 };
    const pin = pinFromClick(320, 200, 0.5, 1280, scroll);
    expect(pinToPoint(pin, 0.5, 1280, scroll)).toEqual({ x: 320, y: 200 });
  });

  it('hides pins outside the visible scroll window', () => {
    const pin = { xPct: 50, yPct: 10 }; // doc y = 320 of 3200
    expect(pinToPoint(pin, 1, 1280, { scrollX: 0, scrollY: 1600, docW: 1280, docH: 3200 })).toBeNull();
    expect(pinToPoint(pin, 1, 1280, { scrollX: 0, scrollY: 0, docW: 1280, docH: 3200 })).toEqual({ x: 640, y: 320 });
  });
});
