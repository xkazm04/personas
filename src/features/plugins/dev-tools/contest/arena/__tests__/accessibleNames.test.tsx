// Accessible names contain what is visible (FE-15): a variant tile is named by
// its concept, key and tray, and lane cells never hang a name on a generic span.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { detailFixture } from '../../__tests__/fixtures';

vi.mock('@/api/contest', () => ({ launchContest: vi.fn(async () => null) }));

import { buildLanes } from '../arenaModel';
import { SeatLane } from '../SeatLane';
import { VariantTile } from '../VariantTile';

afterEach(cleanup);

describe('accessible names', () => {
  it('a tile is named by its visible concept, key and tray', () => {
    const variant = detailFixture().variants[0]!;
    render(<VariantTile variant={variant} bucket="winner" onOpen={() => {}} />);
    const tile = screen.getByTestId('arena-tile-A/1');
    expect(tile).not.toHaveAttribute('aria-label');
    const name = screen.getByRole('button').textContent ?? '';
    expect(name).toContain('A dome of stars');
    expect(name).toContain('A/1');
    expect(name).toContain('Winner');
    expect(screen.getByRole('button', { name: /A dome of stars/ })).toBe(tile);
  });

  it('no lane cell carries aria-label on a generic element', () => {
    const detail = detailFixture();
    const lane = buildLanes(detail).racers[0]!;
    const { container } = render(
      <ul>
        <SeatLane
          lane={lane}
          projectId="p1"
          contestId="hero-page"
          phase="review"
          ceilingS={3600}
          bucketOf={() => null}
          onOpenVariant={() => {}}
        />
      </ul>,
    );
    const generic = [...container.querySelectorAll('span[aria-label], svg[aria-label]')];
    expect(generic.map((el) => el.getAttribute('aria-label'))).toEqual([]);
    expect(container.textContent).toContain('Lane A');
  });
});
