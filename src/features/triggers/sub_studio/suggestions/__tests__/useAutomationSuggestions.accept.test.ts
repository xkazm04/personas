/**
 * Accept walks create(disabled) -> dry-run -> tag -> enable. Once the tag is
 * stamped (acceptAutomationSuggestion) the trigger must survive a failed
 * enable: deleting it leaves the accepted suggestion's committedTriggerId
 * pointing at a trigger that no longer exists, and the suggestion, no longer
 * proposed, can never be retried.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { AutomationSuggestion } from '@/lib/bindings/AutomationSuggestion';

const createTrigger = vi.fn();
const dryRunTrigger = vi.fn();
const updateTrigger = vi.fn();
const deleteTrigger = vi.fn();
const acceptAutomationSuggestion = vi.fn();
const listAutomationSuggestions = vi.fn();
const addToast = vi.fn();

vi.mock('@/api/pipeline/triggers', () => ({
  createTrigger: (...a: unknown[]) => createTrigger(...a),
  dryRunTrigger: (...a: unknown[]) => dryRunTrigger(...a),
  updateTrigger: (...a: unknown[]) => updateTrigger(...a),
  deleteTrigger: (...a: unknown[]) => deleteTrigger(...a),
}));
vi.mock('@/api/pipeline/automationSuggestions', () => ({
  acceptAutomationSuggestion: (...a: unknown[]) => acceptAutomationSuggestion(...a),
  listAutomationSuggestions: (...a: unknown[]) => listAutomationSuggestions(...a),
  rejectAutomationSuggestion: vi.fn(),
}));
vi.mock('@/stores/toastStore', () => ({
  useToastStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector({ addToast }),
    { getState: () => ({ addToast }) },
  ),
}));

import { useAutomationSuggestions } from '../useAutomationSuggestions';

const SUGGESTION: AutomationSuggestion = {
  id: 'sug-1', eventType: 'deploy_completed', personaId: 'p-target', status: 'proposed',
  occurrenceCount: 6, manualRunCount: 8, support: 0.75, windowSeconds: 600, lookbackDays: 30,
  evidence: [], committedTriggerId: null, firstSeenAt: '2026-07-01T10:00:00Z',
  lastSeenAt: '2026-07-28T10:00:00Z', decidedAt: null,
  createdAt: '2026-07-29T10:00:00Z', updatedAt: '2026-07-29T10:00:00Z',
};
const PASSING_DRY_RUN = { valid: true, validation: { checks: [] }, simulated_event: null, matched_subscriptions: [] };

beforeEach(() => {
  createTrigger.mockResolvedValue({ id: 'trg-new' });
  dryRunTrigger.mockResolvedValue(PASSING_DRY_RUN);
  acceptAutomationSuggestion.mockResolvedValue({ ...SUGGESTION, status: 'accepted', committedTriggerId: 'trg-new' });
  updateTrigger.mockResolvedValue(undefined);
  deleteTrigger.mockResolvedValue(undefined);
  listAutomationSuggestions.mockResolvedValue({ suggestions: [SUGGESTION], minerEnabled: true });
});
afterEach(() => { vi.clearAllMocks(); });

describe('accept after the tag is stamped', () => {
  it('keeps the tagged trigger when enabling it fails, and still reports the failure', async () => {
    updateTrigger.mockRejectedValueOnce({ error: 'Database is locked', kind: 'database' });
    const onRouteCommitted = vi.fn();
    const { result } = renderHook(() => useAutomationSuggestions(onRouteCommitted));

    await act(async () => { await result.current.accept(SUGGESTION); });

    expect(acceptAutomationSuggestion).toHaveBeenCalledWith('sug-1', 'trg-new');
    expect(deleteTrigger).not.toHaveBeenCalled();
    expect(addToast.mock.calls.at(-1)?.[1]).toBe('error');
    // The disabled route is real: the ledger reloads to show it paused.
    expect(onRouteCommitted).toHaveBeenCalled();
  });

  it('still rolls back an untagged trigger when the tag itself fails', async () => {
    acceptAutomationSuggestion.mockRejectedValueOnce({ error: 'Not found: suggestion', kind: 'not_found' });
    const { result } = renderHook(() => useAutomationSuggestions());

    await act(async () => { await result.current.accept(SUGGESTION); });

    expect(deleteTrigger).toHaveBeenCalledWith('trg-new', 'p-target');
    expect(updateTrigger).not.toHaveBeenCalled();
  });
});
