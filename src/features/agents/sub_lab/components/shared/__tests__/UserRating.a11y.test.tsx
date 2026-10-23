import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UserRating } from '../UserRating';

describe('UserRating - the chosen thumb is announced, not only tinted', () => {
  it('regression: the stored rating marks its thumb pressed', () => {
    render(<UserRating currentRating={5} onRate={vi.fn()} />);
    const pressed = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true');
    expect(pressed).toHaveLength(1);
    expect(screen.getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'false')).toHaveLength(2);
  });

  it('pressing another thumb moves the pressed state', () => {
    render(<UserRating onRate={vi.fn()} />);
    const [down] = screen.getAllByRole('button');
    fireEvent.click(down!);
    expect(down!.getAttribute('aria-pressed')).toBe('true');
  });
});
