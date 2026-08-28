import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { SigilPetal } from '../SigilPetal';
import { fitSigilSize, SIGIL_MAX_SIZE, SIGIL_MIN_SIZE, SIGIL_SIZE_STEP } from '../InteractiveSigil';

/**
 * The hover tip on the interactive sigil used to live as a `title=` attribute
 * on the HTML icon overlay — an element that is `pointer-events-none` by
 * necessity (the petals underneath own hover, click and keyboard), so no user
 * agent ever surfaced it. It now rides the petal group as an SVG `<title>`,
 * the element hover actually lands on. Pinned here because the defect was
 * invisible: the markup looked correct and rendered nothing.
 */
function renderPetal(
  ariaLabel = 'Trigger: linked',
  extra: { disabled?: boolean; onClick?: () => void; onKeyDown?: () => void; onHover?: () => void } = {},
) {
  return render(
    <svg>
      <SigilPetal
        dim="trigger"
        presence="linked"
        index={0}
        size={200}
        rowId="row-1"
        rowIndex={0}
        glowId="glow-1"
        petalPath="M0 0 L1 1 Z"
        petalPathDashed="M0 0 L1 1 Z"
        isHovered={false}
        isActive={false}
        dimOther={false}
        onHover={extra.onHover ?? vi.fn()}
        onClick={extra.onClick ?? vi.fn()}
        tabIndex={0}
        ariaLabel={ariaLabel}
        isFocused={false}
        onKeyDown={extra.onKeyDown ?? vi.fn()}
        onFocusDim={vi.fn()}
        registerRef={vi.fn()}
        disabled={extra.disabled}
      />
    </svg>,
  );
}

describe('SigilPetal hover tip', () => {
  it('renders the localized label:state as an SVG <title> on the hit target', () => {
    const { container } = renderPetal('Trigger: linked');
    const group = container.querySelector('g[role="button"]');
    expect(group).not.toBeNull();

    const title = group!.querySelector('title');
    expect(title, 'petal has no <title> — the hover tip is unreachable again').not.toBeNull();
    expect(title!.textContent).toBe('Trigger: linked');
  });

  it('keeps the hit target actually hit-testable', () => {
    const { container } = renderPetal();
    const group = container.querySelector('g[role="button"]') as SVGGElement;
    // `pointer-events: none` here is what silently killed the old tooltip.
    expect(group.style.pointerEvents).toBe('auto');
  });

  it('keeps aria-label as the accessible name so the tip adds no duplicate', () => {
    const { container } = renderPetal('Memory: not set');
    const group = container.querySelector('g[role="button"]') as SVGGElement;
    expect(group.getAttribute('aria-label')).toBe('Memory: not set');
  });
});

/**
 * While a build runs the card passes `disabled` — the petal used to keep its
 * tab stop, pointer cursor and click handler and simply do nothing, so both
 * mouse and keyboard users got no signal the control was inert.
 */
describe('SigilPetal disabled state', () => {
  it('drops the tab stop and marks itself aria-disabled', () => {
    const { container } = renderPetal('Trigger: linked', { disabled: true });
    const group = container.querySelector('g[role="button"]') as SVGGElement;
    expect(group.getAttribute('aria-disabled')).toBe('true');
    expect(group.hasAttribute('tabindex')).toBe(false);
    expect(group.style.cursor).toBe('default');
  });

  it('does not invite or accept a click', () => {
    const onClick = vi.fn();
    const onKeyDown = vi.fn();
    const { container } = renderPetal('Trigger: linked', { disabled: true, onClick, onKeyDown });
    const group = container.querySelector('g[role="button"]') as SVGGElement;
    fireEvent.click(group);
    fireEvent.keyDown(group, { key: 'Enter' });
    expect(onClick).not.toHaveBeenCalled();
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('stays fully operable when not disabled', () => {
    const onClick = vi.fn();
    const { container } = renderPetal('Trigger: linked', { onClick });
    const group = container.querySelector('g[role="button"]') as SVGGElement;
    expect(group.getAttribute('tabindex')).toBe('0');
    expect(group.style.cursor).toBe('pointer');
    fireEvent.click(group);
    expect(onClick).toHaveBeenCalledWith('trigger');
  });
});

/**
 * The hero sigil was a literal 440px inside a card that drops to a single
 * column below xl, so it was clipped on both flanks by the card's own
 * overflow-hidden the moment the column narrowed past ~470px.
 */
describe('fitSigilSize', () => {
  it('renders at full size before the card has been measured', () => {
    // A small-then-big pop on first paint would be worse than the bug.
    expect(fitSigilSize(null)).toBe(SIGIL_MAX_SIZE);
    expect(fitSigilSize(0)).toBe(SIGIL_MAX_SIZE);
    expect(fitSigilSize(Number.NaN)).toBe(SIGIL_MAX_SIZE);
  });

  it('never exceeds the space it was given, so nothing is clipped', () => {
    for (const w of [260, 300, 337, 400, 439, 440, 900]) {
      const size = fitSigilSize(w);
      expect(size).toBeLessThanOrEqual(Math.max(w, SIGIL_MIN_SIZE));
      expect(size).toBeLessThanOrEqual(SIGIL_MAX_SIZE);
    }
  });

  it('quantizes so a resize drag cannot mint unbounded geometry cache entries', () => {
    const sizes = new Set<number>();
    for (let w = 240; w <= 640; w += 1) sizes.add(fitSigilSize(w));
    for (const size of sizes) expect(size % SIGIL_SIZE_STEP).toBe(0);
    // 400px of drag must not produce 400 distinct geometries.
    expect(sizes.size).toBeLessThanOrEqual(1 + (SIGIL_MAX_SIZE - SIGIL_MIN_SIZE) / SIGIL_SIZE_STEP);
  });

  it('floors at a legible size rather than collapsing on a narrow card', () => {
    expect(fitSigilSize(60)).toBe(SIGIL_MIN_SIZE);
  });
});

describe('SigilPetal preview on touch', () => {
  it('reports hover from pointer events, which touch also fires', () => {
    // With mouse-only handlers a tap went straight to the panel and the
    // dimension was never named for touch users.
    const onHover = vi.fn();
    const { container } = renderPetal('Trigger: linked', { onHover });
    const group = container.querySelector('g[role="button"]') as SVGGElement;

    fireEvent.pointerEnter(group);
    expect(onHover).toHaveBeenCalledWith('trigger');

    fireEvent.pointerLeave(group);
    expect(onHover).toHaveBeenLastCalledWith(null);
  });
});
