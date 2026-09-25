import { beforeAll, describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const applyLifecycleProposal = vi.fn();
const resolveChatCard = vi.fn();

vi.mock('@/api/companion/lifecycle', () => ({
  applyLifecycleProposal: (...args: unknown[]) => applyLifecycleProposal(...args),
}));
vi.mock('../useChatCards', () => ({
  resolveChatCard: (...args: unknown[]) => resolveChatCard(...args),
}));

import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { LifecycleProposalCard, parseLifecycleProposal } from '../lifecycle/LifecycleProposalCard';

const gateBefore = {
  id: 'gate',
  phase: 'after',
  label: null,
  rule: 'Run the gates.',
  bindings: ['hook'],
  params: {},
};

function config() {
  return {
    projectId: 'p1',
    projectName: 'personas',
    fromVersion: 2,
    preset: 'team',
    changeNote: 'Team practice',
    proposed: { preset: 'team', steps: [] },
    changes: [
      { kind: 'preset', stepId: 'preset', before: null, after: null },
      {
        kind: 'changed',
        stepId: 'gate',
        before: gateBefore,
        after: { ...gateBefore, rule: 'Run the gates; CI must pass.', bindings: ['hook', 'ci'] },
      },
      {
        kind: 'added',
        stepId: 'x-demo',
        before: null,
        after: { id: 'x-demo', phase: 'after', label: 'Demo', rule: 'Record a demo.', bindings: ['claude_md'], params: {} },
      },
    ],
  };
}

describe('LifecycleProposalCard', () => {
  beforeAll(async () => {
    // The card's strings live in the lazily loaded `plugins` section.
    await preloadSectionsAsync('en', ['plugins']);
  });

  beforeEach(() => {
    applyLifecycleProposal.mockReset();
    resolveChatCard.mockReset();
    applyLifecycleProposal.mockResolvedValue({ version: 3, installTaskId: 'task_9' });
  });

  it('renders the version step and one row per change, all ticked', () => {
    render(<LifecycleProposalCard config={config()} cardId="card_1" />);
    expect(screen.getByTestId('lc-proposal-versions').textContent).toContain('v2');
    expect(screen.getByTestId('lc-proposal-versions').textContent).toContain('v3');
    for (const id of ['preset', 'gate', 'x-demo']) {
      expect(screen.getByTestId(`lc-proposal-row-${id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`lc-proposal-toggle-${id}`)).toHaveAttribute('aria-checked', 'true');
    }
    // A custom step shows its own label.
    expect(screen.getByTestId('lc-proposal-row-x-demo').textContent).toContain('Demo');
  });

  it('confirms with ONLY the ticked change ids', async () => {
    render(<LifecycleProposalCard config={config()} cardId="card_1" />);
    fireEvent.click(screen.getByTestId('lc-proposal-toggle-preset'));
    fireEvent.click(screen.getByTestId('lc-proposal-confirm'));
    await waitFor(() => expect(applyLifecycleProposal).toHaveBeenCalledTimes(1));
    expect(applyLifecycleProposal).toHaveBeenCalledWith('card_1', ['gate', 'x-demo']);
    expect(await screen.findByTestId('lc-proposal-saved')).toBeInTheDocument();
    expect(resolveChatCard).toHaveBeenCalledWith('card_1', 'dispatched', {
      applied: { version: 3, installTaskId: 'task_9' },
    });
  });

  it('expands a row to read the rule before and after', () => {
    render(<LifecycleProposalCard config={config()} cardId="card_1" />);
    expect(screen.queryByTestId('lc-proposal-rules-gate')).toBeNull();
    fireEvent.click(screen.getByTestId('lc-proposal-expand-gate'));
    const rules = screen.getByTestId('lc-proposal-rules-gate').textContent ?? '';
    expect(rules).toContain('Run the gates.');
    expect(rules).toContain('Run the gates; CI must pass.');
  });

  it('refuses to confirm with nothing ticked', () => {
    render(<LifecycleProposalCard config={config()} cardId="card_1" />);
    for (const id of ['preset', 'gate', 'x-demo']) {
      fireEvent.click(screen.getByTestId(`lc-proposal-toggle-${id}`));
    }
    expect(screen.getByTestId('lc-proposal-confirm')).toBeDisabled();
  });

  it('dismiss resolves the card without writing anything', () => {
    const { container } = render(<LifecycleProposalCard config={config()} cardId="card_1" />);
    fireEvent.click(screen.getByTestId('lc-proposal-dismiss'));
    expect(container.firstChild).toBeNull();
    expect(resolveChatCard).toHaveBeenCalledWith('card_1', 'dismissed');
    expect(applyLifecycleProposal).not.toHaveBeenCalled();
  });

  it('surfaces a stale-version refusal instead of claiming it saved', async () => {
    applyLifecycleProposal.mockRejectedValue(
      new Error('The lifecycle changed since this proposal; ask Athena to re-propose.'),
    );
    render(<LifecycleProposalCard config={config()} cardId="card_1" />);
    fireEvent.click(screen.getByTestId('lc-proposal-confirm'));
    expect(await screen.findByTestId('lc-proposal-error')).toBeInTheDocument();
    expect(screen.queryByTestId('lc-proposal-saved')).toBeNull();
    expect(screen.getByTestId('lc-proposal-confirm')).toBeInTheDocument();
  });

  it('parses only a real proposal config', () => {
    expect(parseLifecycleProposal(config())).not.toBeNull();
    expect(parseLifecycleProposal({ ...config(), changes: [] })).toBeNull();
    expect(parseLifecycleProposal({ projectId: 'p1' })).toBeNull();
    expect(parseLifecycleProposal(null)).toBeNull();
  });
});
