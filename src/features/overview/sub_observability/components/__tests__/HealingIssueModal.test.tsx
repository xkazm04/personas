// A resolve the backend refused must not show the "Issue resolved" screen.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';
import HealingIssueModal from '../HealingIssueModal';

const ISSUE: PersonaHealingIssue = {
  id: 'issue-1', persona_id: 'persona-1', execution_id: null, title: 'Timeout loop', description: 'd',
  is_circuit_breaker: false, severity: 'medium', category: 'timeout', suggested_fix: null,
  auto_fixed: false, status: 'open', created_at: '2026-10-01T00:00:00Z', resolved_at: null, source: null,
};

describe('HealingIssueModal resolve', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['overview']);
  });

  it('a refused resolve keeps the issue body', async () => {
    const onResolve = vi.fn(() => Promise.resolve(false));
    render(<HealingIssueModal issue={ISSUE} onResolve={onResolve} onClose={() => {}} />);
    await act(async () => { fireEvent.click(screen.getByTestId('healing-issue-resolve')); });
    expect(onResolve).toHaveBeenCalledWith('issue-1');
    expect(screen.queryByText('Issue Resolved')).toBeNull();
    expect(screen.getByTestId('healing-issue-resolve')).toBeTruthy();
  });

  it('a recorded resolve shows the success screen', async () => {
    render(<HealingIssueModal issue={ISSUE} onResolve={() => Promise.resolve(true)} onClose={() => {}} />);
    await act(async () => { fireEvent.click(screen.getByTestId('healing-issue-resolve')); });
    expect(screen.getByText('Issue Resolved')).toBeTruthy();
  });
});
