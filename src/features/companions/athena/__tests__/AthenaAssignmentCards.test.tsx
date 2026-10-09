import { describe, expect, it, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AthenaAssignmentCards } from '../AthenaAssignmentCards';
import { useAthenaStore, type AthenaAssignmentRef } from '../athenaStore';
import { useSystemStore } from '@/stores/systemStore';

function ref(over: Partial<AthenaAssignmentRef> = {}): AthenaAssignmentRef {
  return {
    assignmentId: 'a1',
    teamId: 't1',
    title: 'Harden auth',
    goal: 'g',
    status: 'running',
    totalSteps: 4,
    doneSteps: 1,
    failedSteps: 0,
    updatedAt: 1,
    ...over,
  };
}

describe('AthenaAssignmentCards', () => {
  beforeEach(() => {
    useAthenaStore.setState({ athenaAssignments: [ref(), ref({ assignmentId: 'a2', status: 'done' })] });
  });

  it('renders no nested interactive elements', () => {
    const { container } = render(<AthenaAssignmentCards />);
    expect(container.querySelectorAll('button button').length).toBe(0);
    expect(container.querySelectorAll('button').length).toBe(4);
  });

  it('dismiss is a keyboard-reachable sibling that stays visible on focus', () => {
    render(<AthenaAssignmentCards />);
    const dismiss = screen.getAllByTestId('athena-assignment-dismiss')[0];
    expect(dismiss.tabIndex).not.toBe(-1);
    expect(dismiss.className).toContain('focus-visible:opacity-100');
    expect(dismiss.className).toContain('group-focus-within:opacity-100');
  });

  it('dismiss removes only its card without opening it', () => {
    const section = useSystemStore.getState().sidebarSection;
    render(<AthenaAssignmentCards />);
    fireEvent.click(screen.getAllByTestId('athena-assignment-dismiss')[0]);
    expect(useAthenaStore.getState().athenaAssignments).toHaveLength(1);
    expect(useSystemStore.getState().sidebarSection).toBe(section);
  });

  it('opening a card routes to teams', () => {
    render(<AthenaAssignmentCards />);
    fireEvent.click(screen.getAllByTestId('athena-assignment-open')[0]);
    expect(useSystemStore.getState().sidebarSection).toBe('teams');
  });
});
