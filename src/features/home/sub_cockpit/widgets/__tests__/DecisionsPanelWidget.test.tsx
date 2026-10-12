/**
 * The Home decisions panel reads the Decision Center roster: its count is the
 * roster's total, its rows are the roster's items in the roster's order, and a
 * verdict in its drawer writes through the roster's own `decide`.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import type { DecisionItem } from '@/features/decision-center/model/decisionModel';
import {
  approvalToDecision,
  incidentToDecision,
} from '@/features/decision-center/roster/decisionAdapters';
import { DEFAULT_DECISION_COPY } from '@/features/decision-center/roster/decisionCopy';
import { approvalRow, incidentRow, item } from '@/features/decision-center/__tests__/rosterFixtures';

const roster = {
  items: [] as DecisionItem[],
  total: 0,
  errors: {} as Record<string, string>,
  loading: false,
  decide: vi.fn(async () => undefined),
};
const useDecisionRoster = vi.fn((_options: unknown) => roster);

vi.mock('@/features/decision-center/useDecisionRoster', () => ({
  useDecisionRoster: (options: unknown) => useDecisionRoster(options),
}));

import { DecisionsPanelWidget } from '../DecisionsPanelWidget';

const c = DEFAULT_DECISION_COPY;
const incident = incidentToDecision(incidentRow({ severity: 'critical' }), c);
const approval = approvalToDecision(approvalRow(), 'low', c);
const question = item({ id: 'question:q-1', kind: 'question', title: 'Which region?' });

beforeEach(() => {
  vi.clearAllMocks();
  roster.items = [incident, approval];
  roster.total = 9;
  roster.errors = {};
  roster.loading = false;
});

describe('DecisionsPanelWidget', () => {
  it('loads every chip and shows the roster rows against the roster total', () => {
    render(<DecisionsPanelWidget />);

    expect(useDecisionRoster).toHaveBeenCalledWith({ load: 'all' });
    const table = screen.getByTestId('cockpit-decisions-panel-table');
    expect(within(table).getByText(incident.title)).toBeTruthy();
    expect(within(table).getByText(approval.title)).toBeTruthy();
    // Two rows of the roster's nine: the count says so rather than "2".
    expect(screen.getByTestId('cockpit-widget-decisions_panel').textContent).toContain('2');
    expect(screen.getByTestId('cockpit-widget-decisions_panel').textContent).toContain('9');
  });

  it('writes a drawer verdict through the roster\'s decide', async () => {
    render(<DecisionsPanelWidget />);

    fireEvent.click(screen.getByText(approval.title));
    fireEvent.click(await screen.findByRole('button', { name: approval.verdictLabels.accept }));

    await waitFor(() =>
      expect(roster.decide).toHaveBeenCalledWith({ item: approval, verdict: 'accept', reason: undefined }),
    );
  });

  it('offers no verdict on a build question — it is answered in the hub', async () => {
    roster.items = [question];
    render(<DecisionsPanelWidget />);

    fireEvent.click(screen.getByText(question.title));

    await screen.findByRole('dialog');
    expect(screen.queryByRole('button', { name: question.verdictLabels.accept })).toBeNull();
  });

  it('does not call a failed read "nothing waiting"', () => {
    roster.items = [];
    roster.total = 0;
    roster.errors = { incidents: 'database is locked' };

    render(<DecisionsPanelWidget />);

    expect(screen.queryByText(/nothing waiting/i)).toBeNull();
  });
});
