import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PersonaOverviewEmptyState } from '../PersonaOverviewEmptyState';

describe('PersonaOverviewEmptyState', () => {
  it('names the filters as the cause and offers a reset when personas exist but none match', () => {
    const onReset = vi.fn();
    const onCreate = vi.fn();
    render(<PersonaOverviewEmptyState reason="filters" onResetFilters={onReset} onCreate={onCreate} />);
    expect(screen.getByText('No personas match these filters')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /clear all filters/i }));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('says there are no personas yet and offers to create one when the install is empty', () => {
    const onReset = vi.fn();
    const onCreate = vi.fn();
    render(<PersonaOverviewEmptyState reason="none" onResetFilters={onReset} onCreate={onCreate} />);
    // The two empty causes must not share words: "match" belongs to the
    // filters state only.
    expect(screen.queryByText(/match/i)).toBeNull();
    expect(screen.getByText('No personas yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /create persona/i }));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onReset).not.toHaveBeenCalled();
  });
});
