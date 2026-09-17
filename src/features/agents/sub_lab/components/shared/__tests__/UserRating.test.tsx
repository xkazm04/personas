import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UserRating, scoreToThumb, thumbToScore } from '../UserRating';

/**
 * `lab_user_ratings` stores 1..5 and `upsert_rating` rejects anything else, so
 * the thumbs widget must speak that scale at its edges. Before this mapping it
 * submitted -1/0/1 and every save but thumbs-up was refused at the boundary.
 */
describe('UserRating rating scale', () => {
  it('maps the three thumbs onto the stored 1..5 scale', () => {
    expect(thumbToScore(-1)).toBe(1);
    expect(thumbToScore(0)).toBe(3);
    expect(thumbToScore(1)).toBe(5);
  });

  it('maps a stored score back to the thumb that produced it', () => {
    expect(scoreToThumb(1)).toBe(-1);
    expect(scoreToThumb(2)).toBe(-1);
    expect(scoreToThumb(3)).toBe(0);
    expect(scoreToThumb(5)).toBe(1);
    expect(scoreToThumb(undefined)).toBeUndefined();
  });

  it('submits 5 for thumbs-up', () => {
    const onRate = vi.fn();
    render(<UserRating onRate={onRate} />);
    const buttons = screen.getAllByRole('button');
    // down, neutral, up
    fireEvent.click(buttons[2]);
    fireEvent.click(screen.getByText('Save'));
    expect(onRate).toHaveBeenCalledWith(5, undefined);
  });

  it('submits 1 for thumbs-down and carries the note', () => {
    const onRate = vi.fn();
    render(<UserRating onRate={onRate} />);
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[0]);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'wrong tool' } });
    fireEvent.click(screen.getByText('Save'));
    expect(onRate).toHaveBeenCalledWith(1, 'wrong tool');
  });

  it('submits 3 for neutral', () => {
    const onRate = vi.fn();
    render(<UserRating onRate={onRate} />);
    fireEvent.click(screen.getAllByRole('button')[1]);
    fireEvent.click(screen.getByText('Save'));
    expect(onRate).toHaveBeenCalledWith(3, undefined);
  });
});
