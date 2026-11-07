/**
 * DW-95 (1/2): a board composed by the model is stored unvalidated, so the grid is the last
 * gate before a widget's `actions` become one-click buttons. Two rules, mirroring the Rust
 * `action_allowed_on` in companion/brain/briefing.rs:
 *   - an action rides only on the widget kinds that may carry it (approve/decline only on
 *     `verdict`, rerun only on `issue_list`, pause on `issue_list` | `persona_overview`);
 *   - approve and decline always show their fixed verb, never the model's label, so a button
 *     reading "View details" can never approve a pending action.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { CockpitGrid } from '../panel/CockpitGrid';

const VERDICT_CONFIG = { headline: 'Approve the run', reasoning: 'Because.', intent: 'good' };
const ISSUE_CONFIG = { items: [{ id: 'i1', title: 'A failing persona' }] };

function renderWidget(kind: string, config: Record<string, unknown>, actions: unknown[]) {
  return render(
    <CockpitGrid label="g" widgets={[{ id: 'w', kind, config, actions } as never]} />,
  );
}

describe('the cockpit gates composed widget actions by kind', () => {
  it('an issue_list carrying approve_approval renders no approve button', () => {
    const { queryByTestId } = renderWidget('issue_list', ISSUE_CONFIG, [
      { kind: 'approve_approval', approvalId: 'ap-1', label: 'Approve' },
    ]);
    expect(queryByTestId('briefing-action-approve_approval')).toBeNull();
  });

  it('an issue_list carrying decline_approval renders no decline button', () => {
    const { queryByTestId } = renderWidget('issue_list', ISSUE_CONFIG, [
      { kind: 'decline_approval', approvalId: 'ap-1' },
    ]);
    expect(queryByTestId('briefing-action-decline_approval')).toBeNull();
  });

  it('a verdict carrying rerun_persona renders no rerun button', () => {
    const { queryByTestId } = renderWidget('verdict', VERDICT_CONFIG, [
      { kind: 'rerun_persona', personaId: 'p-1' },
    ]);
    expect(queryByTestId('briefing-action-rerun_persona')).toBeNull();
  });

  it('control: a verdict keeps its legitimate approve button', () => {
    const { getByTestId } = renderWidget('verdict', VERDICT_CONFIG, [
      { kind: 'approve_approval', approvalId: 'ap-1' },
    ]);
    expect(getByTestId('briefing-action-approve_approval').textContent).toContain('Approve');
  });

  it('control: an issue_list keeps its rerun button and its label', () => {
    const { getByTestId } = renderWidget('issue_list', ISSUE_CONFIG, [
      { kind: 'rerun_persona', personaId: 'p-1', label: 'Rerun Scout' },
    ]);
    expect(getByTestId('briefing-action-rerun_persona').textContent).toContain('Rerun Scout');
  });
});

describe('approve and decline show a fixed verb, never the model label', () => {
  it('a verdict approve labelled "View details" reads "Approve"', () => {
    const { getByTestId } = renderWidget('verdict', VERDICT_CONFIG, [
      { kind: 'approve_approval', approvalId: 'ap-1', label: 'View details' },
    ]);
    const button = getByTestId('briefing-action-approve_approval');
    expect(button.textContent).not.toContain('View details');
    expect(button.textContent).toContain('Approve');
  });

  it('a verdict decline labelled "Dismiss" reads "Decline"', () => {
    const { getByTestId } = renderWidget('verdict', VERDICT_CONFIG, [
      { kind: 'decline_approval', approvalId: 'ap-1', label: 'Dismiss' },
    ]);
    const button = getByTestId('briefing-action-decline_approval');
    expect(button.textContent).not.toContain('Dismiss');
    expect(button.textContent).toContain('Decline');
  });
});
