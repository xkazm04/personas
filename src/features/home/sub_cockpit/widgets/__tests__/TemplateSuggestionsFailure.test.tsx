import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const companionMatchTemplates = vi.fn();
const resolveSpy = vi.fn();

vi.mock('@/api/companion', async () => {
  const actual = await vi.importActual<typeof import('@/api/companion')>('@/api/companion');
  return { ...actual, companionMatchTemplates: (...a: unknown[]) => companionMatchTemplates(...a) };
});

vi.mock('@/i18n/useTranslatedError', async () => {
  const actual = await vi.importActual<typeof import('@/i18n/useTranslatedError')>('@/i18n/useTranslatedError');
  return {
    ...actual,
    resolveErrorTranslated: (...a: Parameters<typeof actual.resolveErrorTranslated>) => {
      resolveSpy(a[1]);
      return actual.resolveErrorTranslated(...a);
    },
  };
});

import { TemplateSuggestionsWidget } from '../TemplateSuggestionsWidget';

const APP_ERROR = { error: 'database is locked', kind: 'Database' };
const MATCH = { id: 'tpl-1', name: 'Ticket triage', category: 'support', snippet: 's', connectors: [] };

beforeEach(() => {
  companionMatchTemplates.mockReset();
  resolveSpy.mockReset();
});

/**
 * The template search kept its failure "raw" for the resolver with
 * `err instanceof Error ? err.message : String(err)`, but IPC rejects with a
 * serialized AppError OBJECT, so the resolver was handed "[object Object]" and
 * could only ever answer with the generic sentence. The failure also had no way
 * out: its sibling fetching widgets (RecentDecisions, LinkedDecisions) carry a
 * Retry, this one stayed failed until Athena re-composed it.
 */
describe('TemplateSuggestionsWidget failure', () => {
  it('resolves the AppError text, not "[object Object]"', async () => {
    companionMatchTemplates.mockRejectedValue(APP_ERROR);
    render(<TemplateSuggestionsWidget config={{ intent: 'triage tickets' }} />);
    await waitFor(() => expect(resolveSpy).toHaveBeenCalled());
    expect(resolveSpy).toHaveBeenCalledWith('database is locked');
    expect(resolveSpy).not.toHaveBeenCalledWith('[object Object]');
  });

  it('offers Retry, and a retry that succeeds replaces the error with the matches', async () => {
    companionMatchTemplates.mockRejectedValueOnce(APP_ERROR);
    render(<TemplateSuggestionsWidget config={{ intent: 'triage tickets' }} />);
    const retry = await screen.findByRole('button', { name: /retry|try again/i });

    companionMatchTemplates.mockResolvedValueOnce([MATCH]);
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByTestId('template-suggestion-tpl-1')).toBeTruthy());
    expect(companionMatchTemplates).toHaveBeenCalledTimes(2);
  });
});
