import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { StalenessIndicator } from '../StalenessIndicator';

const TEN_MIN = 10 * 60_000;

describe('StalenessIndicator', () => {
  it('renders the age with no native title tooltip', () => {
    const { container } = render(
      <StalenessIndicator fetchedAt={Date.now() - TEN_MIN} hasError label="cost" />,
    );
    expect(screen.getByText('10m ago')).toBeTruthy();
    // A native `title=` is unthemed, unplaced and invisible to keyboard users
    // (census native-title-tooltip); the label and the failure belong in the
    // shared Tooltip instead.
    expect(container.querySelector('[title]')).toBeNull();
  });

  it('says which source failed, and when it last loaded, on hover', () => {
    vi.useFakeTimers();
    try {
      render(<StalenessIndicator fetchedAt={Date.now() - TEN_MIN} hasError label="cost" />);
      fireEvent.mouseEnter(screen.getByText('10m ago'));
      act(() => {
        vi.advanceTimersByTime(2_000);
      });
      expect(screen.getByText(/cost data last updated 10m ago/)).toBeTruthy();
      expect(screen.getByText(/refresh failed/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders nothing for fresh, healthy data', () => {
    const { container } = render(<StalenessIndicator fetchedAt={Date.now()} hasError={false} />);
    expect(container.innerHTML).toBe('');
  });
});
