import { describe, it, expect, beforeEach } from 'vitest';
import { useSystemStore } from '../systemStore';
import { _resetDedupCacheForTests } from '../util/dedupedStorage';

/**
 * Tests for the `persona-ui-system` persist `onRehydrateStorage` callback.
 *
 * Source: src/stores/systemStore.ts:83 — three things happen on rehydrate:
 *   1. `onboardingDismissedAtStep` is nulled if it isn't a known step id
 *   2. `onboardingStepCompleted` is trimmed to only contain known step keys
 *   3. Legacy `editorTab` values ('prompt', 'connectors', 'health') migrate
 *      to the consolidated 'design' tab with the matching `designSubTab`
 *
 * Strategy: seed localStorage with the persisted shape, call
 * `useSystemStore.persist.rehydrate()`, then read the migrated state.
 */

const STORAGE_KEY = 'persona-ui-system';

function seedPersistedSystemStore(state: Record<string, unknown>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, version: 0 }));
}

describe('systemStore onRehydrateStorage — onboarding schema drift', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetDedupCacheForTests();
    useSystemStore.setState({
      onboardingDismissedAtStep: null,
      onboardingStepCompleted: { appearance: false, discover: false, 'pick-template': false, adopt: false, execute: false },
    });
  });

  it('preserves a known onboardingDismissedAtStep value', async () => {
    seedPersistedSystemStore({ onboardingDismissedAtStep: 'discover' });
    await useSystemStore.persist.rehydrate();
    expect(useSystemStore.getState().onboardingDismissedAtStep).toBe('discover');
  });

  it('nulls an unknown onboardingDismissedAtStep so the overlay does not render blank', async () => {
    // Simulate a step id that existed in a prior schema but was removed.
    seedPersistedSystemStore({ onboardingDismissedAtStep: 'legacy-step-removed-in-v3' });
    await useSystemStore.persist.rehydrate();
    expect(useSystemStore.getState().onboardingDismissedAtStep).toBeNull();
  });

  it('leaves a null onboardingDismissedAtStep alone', async () => {
    seedPersistedSystemStore({ onboardingDismissedAtStep: null });
    await useSystemStore.persist.rehydrate();
    expect(useSystemStore.getState().onboardingDismissedAtStep).toBeNull();
  });

  it('trims onboardingStepCompleted to the known step keys (drops stale ones)', async () => {
    seedPersistedSystemStore({
      onboardingStepCompleted: {
        appearance: true,
        discover: true,
        'legacy-step': true, // removed step
        adopt: false,
      },
    });
    await useSystemStore.persist.rehydrate();
    const completed = useSystemStore.getState().onboardingStepCompleted;
    expect(completed).toEqual({
      appearance: true,
      discover: true,
      'pick-template': false,
      adopt: false,
      execute: false,
    });
    expect(completed).not.toHaveProperty('legacy-step');
  });

  it('coerces missing onboardingStepCompleted keys to false', async () => {
    seedPersistedSystemStore({ onboardingStepCompleted: { appearance: true } });
    await useSystemStore.persist.rehydrate();
    const completed = useSystemStore.getState().onboardingStepCompleted;
    expect(completed.appearance).toBe(true);
    expect(completed.discover).toBe(false);
    expect(completed['pick-template']).toBe(false);
    expect(completed.adopt).toBe(false);
    expect(completed.execute).toBe(false);
  });
});

describe('systemStore onRehydrateStorage — editorTab migration', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetDedupCacheForTests();
    useSystemStore.setState({
      editorTab: 'activity',
      designSubTab: 'use-cases',
    });
  });

  it("migrates legacy 'prompt' to design+prompt", async () => {
    seedPersistedSystemStore({ editorTab: 'prompt' });
    await useSystemStore.persist.rehydrate();
    const state = useSystemStore.getState();
    expect(state.editorTab).toBe('design');
    expect(state.designSubTab).toBe('prompt');
  });

  it("migrates legacy 'connectors' to design+connectors", async () => {
    seedPersistedSystemStore({ editorTab: 'connectors' });
    await useSystemStore.persist.rehydrate();
    const state = useSystemStore.getState();
    expect(state.editorTab).toBe('design');
    expect(state.designSubTab).toBe('connectors');
  });

  it("migrates legacy 'health' to design+prompt", async () => {
    seedPersistedSystemStore({ editorTab: 'health' });
    await useSystemStore.persist.rehydrate();
    const state = useSystemStore.getState();
    expect(state.editorTab).toBe('design');
    expect(state.designSubTab).toBe('prompt');
  });

  it("migrates legacy 'use-cases' editorTab to design+use-cases sub-tab", async () => {
    seedPersistedSystemStore({ editorTab: 'use-cases' });
    await useSystemStore.persist.rehydrate();
    const state = useSystemStore.getState();
    expect(state.editorTab).toBe('design');
    expect(state.designSubTab).toBe('use-cases');
  });

  it("migrates legacy designSubTab 'design' to 'prompt'", async () => {
    seedPersistedSystemStore({ editorTab: 'design', designSubTab: 'design' });
    await useSystemStore.persist.rehydrate();
    const state = useSystemStore.getState();
    expect(state.editorTab).toBe('design');
    expect(state.designSubTab).toBe('prompt');
  });

  it("preserves a current 'design' editorTab as-is", async () => {
    seedPersistedSystemStore({ editorTab: 'design', designSubTab: 'connectors' });
    await useSystemStore.persist.rehydrate();
    const state = useSystemStore.getState();
    expect(state.editorTab).toBe('design');
    expect(state.designSubTab).toBe('connectors');
  });

  it("preserves an unrelated valid editorTab ('settings')", async () => {
    seedPersistedSystemStore({ editorTab: 'settings' });
    await useSystemStore.persist.rehydrate();
    expect(useSystemStore.getState().editorTab).toBe('settings');
  });
});
