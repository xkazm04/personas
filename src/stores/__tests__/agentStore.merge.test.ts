import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore } from '../agentStore';
import { _resetDedupCacheForTests } from '../util/dedupedStorage';

/**
 * Tests for the `persona-ui-agents` persist `merge` migration.
 *
 * Source: src/stores/agentStore.ts:50 — migrates persisted `chatMode: 'ops'`
 * (the legacy "ops" hub) to `'advisory'` (the renamed advisory hub) and
 * sanitizes unknown values back to the current default.
 *
 * Strategy: seed localStorage with the persisted shape we want to test, call
 * `useAgentStore.persist.rehydrate()`, then read the merged state. This
 * exercises the real `merge` callback rather than a copy of its logic.
 */

const STORAGE_KEY = 'persona-ui-agents';

function seedPersistedAgentStore(state: Record<string, unknown>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, version: 0 }));
}

describe('agentStore persist merge — chatMode migration', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetDedupCacheForTests();
    // Reset just the chatMode field so each test starts from the configured default.
    useAgentStore.setState({ chatMode: 'agent' });
  });

  it("migrates legacy 'ops' to 'advisory'", async () => {
    seedPersistedAgentStore({ chatMode: 'ops' });
    await useAgentStore.persist.rehydrate();
    expect(useAgentStore.getState().chatMode).toBe('advisory');
  });

  it("preserves 'advisory' as-is", async () => {
    seedPersistedAgentStore({ chatMode: 'advisory' });
    await useAgentStore.persist.rehydrate();
    expect(useAgentStore.getState().chatMode).toBe('advisory');
  });

  it("preserves 'agent' as-is", async () => {
    seedPersistedAgentStore({ chatMode: 'agent' });
    await useAgentStore.persist.rehydrate();
    expect(useAgentStore.getState().chatMode).toBe('agent');
  });

  it('drops unknown chatMode values back to the current default', async () => {
    // Simulate persisted state from a future schema with a value the current
    // build doesn't know about. The merge guard ensures we don't render an
    // unrenderable mode.
    useAgentStore.setState({ chatMode: 'agent' });
    seedPersistedAgentStore({ chatMode: 'spaceship' });
    await useAgentStore.persist.rehydrate();
    expect(useAgentStore.getState().chatMode).toBe('agent');
  });

  it('falls back to current default when chatMode is missing entirely', async () => {
    useAgentStore.setState({ chatMode: 'agent' });
    seedPersistedAgentStore({ selectedPersonaId: 'p-1' });
    await useAgentStore.persist.rehydrate();
    expect(useAgentStore.getState().chatMode).toBe('agent');
  });

  it('preserves non-chatMode persisted fields verbatim', async () => {
    seedPersistedAgentStore({
      chatMode: 'ops',
      selectedPersonaId: 'p-42',
      activeChatSessionId: 'sess-1',
    });
    await useAgentStore.persist.rehydrate();
    const state = useAgentStore.getState();
    expect(state.chatMode).toBe('advisory');
    expect(state.selectedPersonaId).toBe('p-42');
    expect(state.activeChatSessionId).toBe('sess-1');
  });
});
