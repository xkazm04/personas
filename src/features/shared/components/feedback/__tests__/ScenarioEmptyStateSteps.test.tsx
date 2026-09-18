import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ScenarioEmptyState from '../ScenarioEmptyState';

describe('ScenarioEmptyState step guide', () => {
  it('renders each step with a handler as a button and calls it', () => {
    const create = vi.fn();
    const credential = vi.fn();
    render(
      <ScenarioEmptyState
        variant="dashboard-no-executions"
        stepActions={[create, credential, undefined]}
      />,
    );
    const createBtn = screen.getByRole('button', { name: 'Create an agent' });
    fireEvent.click(createBtn);
    expect(create).toHaveBeenCalledTimes(1);
    expect(credential).not.toHaveBeenCalled();

    // The third step got no handler, so it stays a caption, not a tab stop.
    expect(screen.queryByRole('button', { name: 'Run your agent' })).toBeNull();
    expect(screen.getByText('Run your agent')).toBeTruthy();
  });

  it('keeps every step a static caption when no stepActions are passed', () => {
    render(<ScenarioEmptyState variant="dashboard-no-executions" />);
    expect(screen.queryByRole('button', { name: 'Create an agent' })).toBeNull();
    expect(screen.getByText('Create an agent')).toBeTruthy();
  });

  it('renders variants without steps unchanged', () => {
    render(<ScenarioEmptyState variant="no-results" stepActions={[vi.fn()]} />);
    expect(screen.queryByText('Create an agent')).toBeNull();
  });
});
