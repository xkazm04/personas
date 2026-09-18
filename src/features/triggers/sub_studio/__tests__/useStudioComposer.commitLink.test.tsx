/**
 * Two commit doors, one safety net.
 *
 * `useAutomationSuggestions.accept` walks a MINED cable through
 * create-disabled -> dry-run -> enable, and deletes the trigger when the
 * dry-run fails. A hand-drawn persona link went live on `createTrigger` alone,
 * so a stale source persona id or an unresolvable `jsonpath` condition reached
 * production silently — `engine/chain.rs` treats an unresolvable path as
 * non-matching, not as an error, so the chain simply never fires and nothing
 * says why.
 *
 * These cases pin the sequence rather than the outcome: a passing dry-run must
 * end ENABLED (not merely "created"), and a failing one must leave nothing
 * behind. Asserting only "createTrigger was called" would pass against the
 * exact defect this closes.
 */
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { DraftLink } from '../libs/studioDraftModel';

const createTrigger = vi.fn();
const dryRunTrigger = vi.fn();
const updateTrigger = vi.fn();
const deleteTrigger = vi.fn();
const addToast = vi.fn();

vi.mock('@/api/pipeline/triggers', () => ({
  createTrigger: (...a: unknown[]) => createTrigger(...a),
  dryRunTrigger: (...a: unknown[]) => dryRunTrigger(...a),
  updateTrigger: (...a: unknown[]) => updateTrigger(...a),
  deleteTrigger: (...a: unknown[]) => deleteTrigger(...a),
}));

vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (selector: (s: unknown) => unknown) => selector({ personas: [] }),
}));

vi.mock('@/stores/toastStore', () => ({
  useToastStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector({ addToast }),
    { getState: () => ({ addToast }) },
  ),
}));

vi.mock('../system_ops/useSystemOpStudio', () => ({
  useSystemOpStudio: () => ({ options: [], commitSystemOp: vi.fn() }),
}));

import { useStudioComposer } from '../useStudioComposer';

const PERSONA_LINK: DraftLink = {
  id: 'link-1',
  source: { kind: 'persona', personaId: 'src-persona' },
  targetPersonaId: 'dst-persona',
  condition: 'output_match',
  outputMatch: { path: '$.status', expected: 'ok' },
};

const MARKETPLACE_LINK: DraftLink = {
  id: 'link-2',
  source: { kind: 'marketplace', slug: 'ci-failures', label: 'CI failures' },
  targetPersonaId: 'dst-persona',
  condition: null,
};

const passingDryRun = { valid: true, validation: { checks: [] }, simulated_event: null, matched_subscriptions: [] };
const failingDryRun = {
  valid: false,
  validation: { checks: [{ passed: true, message: 'source exists' }, { passed: false, message: 'jsonpath unresolvable' }] },
  simulated_event: null,
  matched_subscriptions: [],
};

beforeEach(() => {
  localStorage.clear();
  createTrigger.mockResolvedValue({ id: 'trg-new' });
  dryRunTrigger.mockResolvedValue(passingDryRun);
  updateTrigger.mockResolvedValue(undefined);
  deleteTrigger.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('commitLink for a persona source', () => {
  it('creates disabled, dry-runs, then enables', async () => {
    const { result } = renderHook(() => useStudioComposer());

    let ok = false;
    await act(async () => { ok = await result.current.commitLink(PERSONA_LINK); });

    expect(ok).toBe(true);
    expect(createTrigger).toHaveBeenCalledTimes(1);
    expect(createTrigger.mock.calls[0][0]).toMatchObject({
      persona_id: 'dst-persona',
      trigger_type: 'chain',
      enabled: false,
    });
    expect(dryRunTrigger).toHaveBeenCalledWith('trg-new');
    expect(updateTrigger).toHaveBeenCalledWith('trg-new', 'dst-persona', { enabled: true });
    expect(deleteTrigger).not.toHaveBeenCalled();
  });

  it('deletes the trigger and never enables it when the dry-run fails', async () => {
    dryRunTrigger.mockResolvedValue(failingDryRun);
    const { result } = renderHook(() => useStudioComposer());

    let ok = true;
    await act(async () => { ok = await result.current.commitLink(PERSONA_LINK); });

    expect(ok).toBe(false);
    expect(updateTrigger).not.toHaveBeenCalled();
    await waitFor(() => expect(deleteTrigger).toHaveBeenCalledWith('trg-new', 'dst-persona'));
    // The failing check's own message reaches the user, not a generic failure.
    expect(addToast.mock.calls.at(-1)?.[0]).toContain('jsonpath unresolvable');
    expect(addToast.mock.calls.at(-1)?.[1]).toBe('error');
  });
});

describe('commitLink for a marketplace source', () => {
  it('still commits directly — the subscription fully specifies it', async () => {
    const { result } = renderHook(() => useStudioComposer());

    await act(async () => { await result.current.commitLink(MARKETPLACE_LINK); });

    expect(createTrigger.mock.calls[0][0]).toMatchObject({ trigger_type: 'event_listener', enabled: true });
    expect(dryRunTrigger).not.toHaveBeenCalled();
  });
});
