import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CapabilitySigil } from '../CapabilitySigil';
import type { DisplayUseCase } from '@/features/agents/sub_use_cases/components/recipes-prototype/shared/displayUseCase';

/**
 * The sigil's `<radialGradient>` (and, in CVD-safe mode, its eight
 * `<pattern>` tiles) live in the instance's own `<defs>` and are referenced by
 * `url(#id)`. SVG resolves that to the FIRST element with the id in document
 * order — so two instances sharing an id silently share one gradient.
 *
 * The ids used to be keyed on `(uc.id, size)`, and two surfaces render the
 * same capability at the same default size (UseCaseRow's SIGIL_SIZE = 72,
 * CapabilityTabBar's sigilSize = 72). That collided. It was invisible only
 * because both copies happened to emit identical stops — while the stops
 * already vary with `isDisabled` and the id did not.
 */
const uc = (overrides: Partial<DisplayUseCase> = {}): DisplayUseCase => ({
  id: 'uc-1',
  title: 'Draft the weekly digest',
  description: '',
  mode: 'e2e',
  health: 'active',
  hasModelOverride: false,
  notificationChannels: [],
  triggerLabel: '',
  connector: '',
  connectorKey: null,
  dimensions: ['trigger', 'task'],
  // Invariant justifying the one cast in this fixture: CapabilitySigil reads
  // `title`, `dimensions` and `health` and nothing else off the use case —
  // `raw` is the escape hatch for policy controls and history fetches, which
  // this component has none of. Building a full DesignUseCase here would add
  // ~30 lines of irrelevant shape.
  raw: {} as DisplayUseCase['raw'],
  ...overrides,
});

function gradientIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('radialGradient'))
    .map((g) => g.getAttribute('id') ?? '');
}

describe('CapabilitySigil SVG ids', () => {
  it('gives two instances of the same capability at the same size distinct ids', () => {
    const { container } = render(
      <>
        <CapabilitySigil uc={uc()} size={72} />
        <CapabilitySigil uc={uc()} size={72} />
      </>,
    );
    const ids = gradientIds(container);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size, `colliding gradient ids: ${ids.join(', ')}`).toBe(2);
  });

  it('keeps every id free of the colons React puts in useId values', () => {
    // These ids travel inside `url(#…)` fragments; a stray colon is the kind
    // of thing that works in one engine and not the next.
    const { container } = render(<CapabilitySigil uc={uc()} size={68} />);
    for (const id of gradientIds(container)) {
      expect(id).not.toContain(':');
      expect(id.length).toBeGreaterThan('mini-core-'.length);
    }
  });

  it('points the core fill at its own gradient', () => {
    const { container } = render(<CapabilitySigil uc={uc()} size={84} />);
    const [id] = gradientIds(container);
    const referencing = Array.from(container.querySelectorAll('circle'))
      .map((c) => c.getAttribute('fill'))
      .filter((f): f is string => !!f && f.startsWith('url('));
    expect(referencing).toContain(`url(#${id})`);
  });
});
