import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import {
  READING_BAND,
  resolveActiveSection,
  useSectionScrollSpy,
  type ReadingBand,
} from '../useSectionScrollSpy';

const ids = ['engine', 'limits', 'appearance'];
// The band a 900px-tall window produces: [12, 12 + 297).
const band: ReadingBand = { top: 12, bottom: 12 + 900 * READING_BAND.fraction };

const tops = (values: Record<string, number>) => new Map(Object.entries(values));

describe('resolveActiveSection', () => {
  it('activates a heading inside the band that the old 28px line would have missed', () => {
    // 48px down: past the retired ACTIVATION_OFFSET of 28, comfortably in band.
    const next = resolveActiveSection(
      ids,
      tops({ engine: -400, limits: 48, appearance: 700 }),
      band,
      'engine',
    );
    expect(next).toBe('limits');
  });

  it('picks the TOPMOST heading when two sit in the band together', () => {
    const next = resolveActiveSection(
      ids,
      tops({ engine: 20, limits: 120, appearance: 900 }),
      band,
      'appearance',
    );
    expect(next).toBe('engine');
  });

  it('keeps the highlight on a long section whose heading has left the band', () => {
    // Reading deep into `limits`: its heading is far above, the next is far below.
    const next = resolveActiveSection(
      ids,
      tops({ engine: -3000, limits: -1200, appearance: 2000 }),
      band,
      'limits',
    );
    expect(next).toBe('limits');
  });

  it('does not flip on a nudge that crosses no band edge', () => {
    const before = resolveActiveSection(
      ids,
      tops({ engine: -900, limits: -26, appearance: 1400 }),
      band,
      'limits',
    );
    const after = resolveActiveSection(
      ids,
      tops({ engine: -901, limits: -27, appearance: 1399 }),
      band,
      before,
    );
    expect(before).toBe('limits');
    expect(after).toBe('limits');
  });

  it('corrects an answer the layout contradicts (a fling past the band)', () => {
    // `appearance` was carried clean through the band; `limits` is no longer
    // a defensible answer even though the band is empty.
    const next = resolveActiveSection(
      ids,
      tops({ engine: -5000, limits: -3000, appearance: -20 }),
      band,
      'limits',
    );
    expect(next).toBe('appearance');
  });

  it('keeps the first section while everything is still below the band', () => {
    const next = resolveActiveSection(
      ids,
      tops({ engine: 600, limits: 1200, appearance: 1800 }),
      band,
      'engine',
    );
    expect(next).toBe('engine');
  });

  it('ignores ids whose element has not mounted', () => {
    const next = resolveActiveSection(ids, tops({ appearance: 40 }), band, 'engine');
    expect(next).toBe('appearance');
  });
});

describe('useSectionScrollSpy', () => {
  const originalRect = Element.prototype.getBoundingClientRect;
  afterEach(() => {
    Element.prototype.getBoundingClientRect = originalRect;
  });

  function Harness({ positions }: { positions: Record<string, number> }) {
    const { activeId, register } = useSectionScrollSpy(ids);
    return (
      <div data-testid="active" data-active={activeId}>
        {ids.map((id) => (
          <section key={id} ref={register(id)} data-section={id}>
            {id}
          </section>
        ))}
        {/* positions is read by the stubbed rect below */}
        <span data-testid="positions">{JSON.stringify(positions)}</span>
      </div>
    );
  }

  function stubRects(positions: Record<string, number>) {
    Element.prototype.getBoundingClientRect = function stub(this: Element) {
      const id = (this as HTMLElement).dataset?.section;
      const top = id ? (positions[id] ?? 0) : 0;
      return { top, bottom: top + 40, left: 0, right: 0, width: 0, height: 40, x: 0, y: top } as DOMRect;
    };
  }

  it('lands a heading in the band on mount and tracks a scroll', () => {
    const positions: Record<string, number> = { engine: -400, limits: 48, appearance: 800 };
    stubRects(positions);
    const { container } = render(<Harness positions={positions} />);
    expect(container.querySelector('[data-testid="active"]')?.getAttribute('data-active')).toBe(
      'limits',
    );

    // Scroll on: `limits` leaves the band upward, `appearance` is not in it yet.
    positions.limits = -1500;
    positions.appearance = 900;
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(container.querySelector('[data-testid="active"]')?.getAttribute('data-active')).toBe(
      'limits',
    );
  });

  it('jumpTo scrolls the parent so the heading lands at the band top inset', () => {
    const positions: Record<string, number> = { engine: 0, limits: 500, appearance: 1000 };
    stubRects(positions);
    const scrollTo = vi.fn();

    function ParentHarness() {
      const { jumpTo, register } = useSectionScrollSpy(ids);
      return (
        <div
          style={{ overflowY: 'auto' }}
          ref={(el) => {
            if (el) {
              Object.defineProperty(el, 'scrollTo', { value: scrollTo, configurable: true });
              Object.defineProperty(el, 'scrollTop', { value: 100, configurable: true });
            }
          }}
        >
          {ids.map((id) => (
            <section key={id} ref={register(id)} data-section={id}>
              {id}
            </section>
          ))}
          <button type="button" onClick={() => jumpTo('limits')}>
            go
          </button>
        </div>
      );
    }

    const { getByText } = render(<ParentHarness />);
    act(() => {
      getByText('go').click();
    });
    // delta 500, scrollTop 100, minus the band's top inset — the same offset
    // budget the spy activates on, so the jump target IS in the band.
    expect(scrollTo).toHaveBeenCalledWith({ top: 600 - READING_BAND.topInset, behavior: 'smooth' });
  });
});
