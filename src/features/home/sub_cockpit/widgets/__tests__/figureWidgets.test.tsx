import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const runDecisionOption = vi.fn();
vi.mock('@/features/companions/athena/decision/resolveDecision', () => ({
  runDecisionOption: (...args: unknown[]) => runDecisionOption(...args),
}));

const openExternalUrl = vi.fn(() => Promise.resolve());
vi.mock('@/api/system/system', () => ({ openExternalUrl: (url: string) => openExternalUrl(url) }));

import { useAthenaStore } from '@/features/companions/athena/athenaStore';
import { deltaTone, intentTone } from '../intentColors';
import { IssueListWidget } from '../IssueListWidget';
import { StatGridWidget } from '../StatGridWidget';
import { VerdictWidget } from '../VerdictWidget';

beforeEach(() => {
  runDecisionOption.mockReset();
  openExternalUrl.mockClear();
});

describe('tone by meaning', () => {
  it('colours a delta by what the figure means, not by its direction', () => {
    expect(deltaTone({ intent: 'warn', trend: 'up' })).toBe('warning'); // spend +38%
    expect(deltaTone({ intent: 'bad', trend: 'up' })).toBe('error'); // issues +3
    expect(deltaTone({ intent: 'good', trend: 'down' })).toBe('warning'); // success rate -1.2
    expect(deltaTone({ intent: 'good', trend: 'up' })).toBe('success');
    expect(deltaTone({ intent: 'default', trend: 'up' })).toBe('neutral'); // runs +212
    expect(deltaTone({ trend: 'up' })).toBe('neutral');
  });

  it('lets a stated polarity or delta intent win', () => {
    expect(deltaTone({ intent: 'bad', trend: 'down', better: 'down' })).toBe('success');
    expect(deltaTone({ intent: 'default', trend: 'up', better: 'down' })).toBe('warning');
    expect(deltaTone({ intent: 'good', trend: 'up', delta_intent: 'bad' })).toBe('error');
    expect(deltaTone({ trend: 'flat', better: 'up' })).toBe('neutral');
  });

  it('maps intent and severity words, with a fallback', () => {
    expect(intentTone('critical')).toBe('error');
    expect(intentTone('medium')).toBe('warning');
    expect(intentTone('nonsense', 'info')).toBe('info');
    expect(intentTone(undefined)).toBe('neutral');
  });
});

describe('figure widgets', () => {
  it('stat_grid renders every label whole and the delta beside its figure', () => {
    render(<StatGridWidget title="Fleet vitals" config={{ stats: [
      { label: 'Success rate', value: 90.6, unit: '%', intent: 'good', delta: '-1.2', trend: 'down' },
      { label: 'Failures (7d)', value: 121, intent: 'bad', delta: '+18', trend: 'up' },
    ] }} />);
    expect(screen.getByText('Success rate')).toBeTruthy();
    expect(screen.getByText('-1.2').className).toContain('t-warning');
    expect(screen.getByText('+18').className).toContain('t-error');
  });

  it('issue_list caps a long list and opens an href through the outbound door', () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ id: `i${i}`, title: `Issue ${i}`, href: i === 0 ? 'https://example.test/0' : undefined }));
    render(<IssueListWidget title="Needs attention" config={{ items }} />);
    expect(screen.queryByText('Issue 8')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Issue 0' }));
    expect(openExternalUrl).toHaveBeenCalledWith('https://example.test/0');
  });

  it('verdict resolves the pending decision from its footer buttons', () => {
    const opt = { key: 'approve', label: 'Escalate to finance' };
    useAthenaStore.setState({ pendingDecision: { id: 'd1', prompt: 'p', options: [opt, { key: 'later', label: 'Later', hint: 'Snooze' }] } } as never);
    render(<VerdictWidget config={{ headline: 'Escalate it', intent: 'warn', recommended_option: 1 }} />);
    fireEvent.click(screen.getByTestId('cockpit-verdict-option-1'));
    expect(runDecisionOption).toHaveBeenCalledWith(opt);
    expect(screen.getByTestId('cockpit-verdict-option-2')).toBeTruthy();
    act(() => { useAthenaStore.setState({ pendingDecision: null } as never); });
  });
});
