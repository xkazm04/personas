import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CompanionTemplateMatch } from '@/api/companion';

const matches: CompanionTemplateMatch[] = [
  { id: 'tpl-1', name: 'Support triage', snippet: 'Triage inbound tickets' },
  { id: 'tpl-2', name: 'PR watcher', snippet: 'Watch GitHub PRs' },
] as unknown as CompanionTemplateMatch[];

const companionMatchTemplates = vi.fn(async () => matches);
vi.mock('@/api/companion', () => ({
  companionMatchTemplates: (...a: unknown[]) => companionMatchTemplates(...(a as [])),
}));

import { PersonaOverviewEmptyState } from '../PersonaOverviewEmptyState';

describe('PersonaOverviewEmptyState — first-run template matching', () => {
  beforeEach(() => {
    companionMatchTemplates.mockClear();
    vi.useRealTimers();
  });

  function renderEmpty(onStartFromIntent?: (i: string, m: CompanionTemplateMatch | null) => void) {
    render(
      <PersonaOverviewEmptyState
        reason="none"
        onResetFilters={() => {}}
        onCreate={() => {}}
        {...(onStartFromIntent ? { onStartFromIntent } : {})}
      />,
    );
  }

  it('starts from the template the user picked out of the ranked matches', async () => {
    const onStart = vi.fn();
    renderEmpty(onStart);
    fireEvent.change(screen.getByTestId('roster-empty-intent'), {
      target: { value: 'triage support tickets' },
    });
    await waitFor(() => expect(screen.getByTestId('roster-empty-template-tpl-1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('roster-empty-template-tpl-1'));
    expect(onStart).toHaveBeenCalledWith('triage support tickets', matches[0]);
  });

  it('still starts from the typed intent when nothing matches', async () => {
    companionMatchTemplates.mockResolvedValueOnce([]);
    const onStart = vi.fn();
    renderEmpty(onStart);
    fireEvent.change(screen.getByTestId('roster-empty-intent'), {
      target: { value: 'something nobody templated' },
    });
    await waitFor(() =>
      expect(screen.getByTestId('roster-empty-start-from-intent')).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId('roster-empty-start-from-intent'));
    expect(onStart).toHaveBeenCalledWith('something nobody templated', null);
  });

  it('shows the bare Create action when no intent handler is supplied', () => {
    renderEmpty();
    expect(screen.queryByTestId('roster-empty-intent')).toBeNull();
  });
});
