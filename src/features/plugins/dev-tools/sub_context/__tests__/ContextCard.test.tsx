import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// useSystemStore is touched from ContextCard for the click-jump handoff —
// minimal mock returns vi.fn() setters so we can assert call shape.
const setDevToolsTab = vi.fn();
const setPendingGoalSpotlightId = vi.fn();

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      setDevToolsTab,
      setPendingGoalSpotlightId,
    }),
}));

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: {
      plugins: {
        dev_tools: {
          context_goal_singular: 'goal',
          context_goal_plural: 'goals',
          context_goal_coverage_tooltip: 'Open in Goals',
          context_no_goal_label: 'no goal',
          context_no_goal_tooltip: 'No goal references this context yet',
        },
      },
    },
    tx: (s: string) => s,
  }),
}));

import ContextCard from '../ContextCard';
import type { ContextItem } from '../contextMapTypes';

function makeCtx(overrides: Partial<ContextItem> = {}): ContextItem {
  return {
    id: 'ctx-1',
    groupId: 'grp-1',
    name: 'Auth module',
    description: 'Login + session management',
    filePaths: ['src/auth/login.ts', 'src/auth/session.ts'],
    keywords: ['auth', 'jwt'],
    entryPoints: [],
    ...overrides,
  };
}

describe('ContextCard goal-coverage badge', () => {
  beforeEach(() => {
    setDevToolsTab.mockClear();
    setPendingGoalSpotlightId.mockClear();
  });

  it('renders the "no goal" hint when goalCount is 0', () => {
    render(<ContextCard ctx={makeCtx()} selected={false} onSelect={() => {}} goalCount={0} />);
    expect(screen.getByText('no goal')).toBeInTheDocument();
  });

  it('renders "1 goal" (singular) when goalCount is 1', () => {
    render(<ContextCard ctx={makeCtx()} selected={false} onSelect={() => {}} goalCount={1} firstGoalId="g-1" />);
    expect(screen.getByText(/1\s+goal\b/)).toBeInTheDocument();
  });

  it('renders "N goals" (plural) when goalCount > 1', () => {
    render(<ContextCard ctx={makeCtx()} selected={false} onSelect={() => {}} goalCount={3} firstGoalId="g-1" />);
    expect(screen.getByText(/3\s+goals\b/)).toBeInTheDocument();
  });

  it('clicking the goal badge seeds the spotlight and jumps to Goals', () => {
    render(<ContextCard ctx={makeCtx()} selected={false} onSelect={() => {}} goalCount={2} firstGoalId="goal-XYZ" />);
    const badge = screen.getByTitle(/open in goals/i);
    fireEvent.click(badge);
    expect(setPendingGoalSpotlightId).toHaveBeenCalledWith('goal-XYZ');
    expect(setDevToolsTab).toHaveBeenCalledWith('goals');
  });

  it('clicking the goal badge does NOT trigger the card onSelect handler', () => {
    const onSelect = vi.fn();
    render(<ContextCard ctx={makeCtx()} selected={false} onSelect={onSelect} goalCount={2} firstGoalId="g-1" />);
    fireEvent.click(screen.getByTitle(/open in goals/i));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('still jumps when firstGoalId is undefined but goalCount > 0', () => {
    // Defensive — shouldn't normally happen but the badge logic should not crash.
    render(<ContextCard ctx={makeCtx()} selected={false} onSelect={() => {}} goalCount={1} />);
    fireEvent.click(screen.getByTitle(/open in goals/i));
    expect(setPendingGoalSpotlightId).not.toHaveBeenCalled();
    expect(setDevToolsTab).toHaveBeenCalledWith('goals');
  });
});
