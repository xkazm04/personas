import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';

// A rejected sensory-policy read must show as failed with a retry, not as the
// all-ON defaults (a Save from there overwrites the stored policy).

const fetchSensoryPolicy = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (sel: (s: Record<string, unknown>) => unknown) => sel(state.current),
}));
vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ selectedPersonaId: 'p1' }),
}));

import { AmbientContextPanel } from '../AmbientContextPanel';

beforeAll(async () => {
  await preloadSectionsAsync('en', ['settings', 'shared']);
});
beforeEach(() => {
  fetchSensoryPolicy.mockClear();
  const noop = vi.fn();
  state.current = {
    ambientSnapshot: null,
    ambientEnabled: true,
    ambientPolicy: null,
    ambientPolicyError: null,
    contextRules: [],
    contextStreamStats: null,
    fetchAmbientSnapshot: noop,
    toggleAmbientEnabled: noop,
    fetchSensoryPolicy,
    updateSensoryPolicy: vi.fn().mockResolvedValue(undefined),
    resetSensoryPolicy: noop,
    fetchContextRules: noop,
    addContextRule: noop,
    removeContextRule: noop,
    fetchContextStreamStats: noop,
  };
});

describe('AmbientContextPanel policy read failure', () => {
  it('shows an error with retry and no policy toggles', () => {
    state.current.ambientPolicyError = { error: 'database is locked', kind: 'database' };
    render(<AmbientContextPanel />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /clipboard/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(fetchSensoryPolicy).toHaveBeenLastCalledWith('p1');
  });

  it('shows the toggles when the read succeeded', () => {
    state.current.ambientPolicy = { clipboard: true, fileChanges: false, appFocus: true, focusAppFilter: [] };
    render(<AmbientContextPanel />);
    expect(screen.getByRole('button', { name: /clipboard/i })).toBeTruthy();
  });
});
