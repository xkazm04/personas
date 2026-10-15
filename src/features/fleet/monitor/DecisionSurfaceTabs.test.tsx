import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useSystemStore } from '@/stores/systemStore';
import { DecisionSurfaceTabs } from './DecisionSurfaceTabs';

describe('DecisionSurfaceTabs', () => {
  beforeEach(() => useSystemStore.setState({ decisionSurface: 'chips' }));

  it('flips the store both ways and presses the active side', () => {
    render(<DecisionSurfaceTabs />);
    expect(screen.getByTestId('decision-surface-chips').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('decision-surface-lanes'));
    expect(useSystemStore.getState().decisionSurface).toBe('lanes');
    expect(screen.getByTestId('decision-surface-lanes').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('decision-surface-chips'));
    expect(useSystemStore.getState().decisionSurface).toBe('chips');
  });
});
