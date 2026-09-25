import { describe, it, expect, beforeEach } from 'vitest';
import { useSystemStore } from '../systemStore';
import { _resetDedupCacheForTests } from '../util/dedupedStorage';
import { COMPANIONS_PAGES } from '@/features/companions/types';
import { ALL_SIDEBAR_SECTIONS } from '@/lib/navigation/registry';

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
      designSubTab: 'manifest',
    });
  });

  it("migrates legacy 'prompt' to design+manifest", async () => {
    // The Properties/Prompt recap has no successor surface: what a persona IS
    // is authored in its manifest now.
    seedPersistedSystemStore({ editorTab: 'prompt' });
    await useSystemStore.persist.rehydrate();
    const state = useSystemStore.getState();
    expect(state.editorTab).toBe('design');
    expect(state.designSubTab).toBe('manifest');
  });

  it("migrates legacy 'connectors' to design+connectors", async () => {
    seedPersistedSystemStore({ editorTab: 'connectors' });
    await useSystemStore.persist.rehydrate();
    const state = useSystemStore.getState();
    expect(state.editorTab).toBe('design');
    expect(state.designSubTab).toBe('connectors');
  });

  it("migrates legacy 'health' to design+manifest", async () => {
    seedPersistedSystemStore({ editorTab: 'health' });
    await useSystemStore.persist.rehydrate();
    const state = useSystemStore.getState();
    expect(state.editorTab).toBe('design');
    expect(state.designSubTab).toBe('manifest');
  });

  it("migrates legacy 'use-cases' editorTab to design+responsibilities sub-tab", async () => {
    // A use case became a standing charter with the agent-manifest rebase.
    seedPersistedSystemStore({ editorTab: 'use-cases' });
    await useSystemStore.persist.rehydrate();
    const state = useSystemStore.getState();
    expect(state.editorTab).toBe('design');
    expect(state.designSubTab).toBe('responsibilities');
  });

  it("remaps every retired designSubTab rather than discarding it", async () => {
    // A REMAP, not a discard: each retired surface had a successor, and the
    // user should land on the tab that inherited its job.
    const cases: [string, string][] = [
      ['design', 'manifest'],
      ['prompt', 'manifest'],
      ['parameters', 'manifest'],
      ['core', 'manifest'],
      ['use-cases', 'responsibilities'],
      ['triggers', 'connectors'],
      ['messaging', 'connectors'],
      ['automations', 'connectors'],
    ];
    for (const [retired, expected] of cases) {
      localStorage.clear();
      _resetDedupCacheForTests();
      seedPersistedSystemStore({ editorTab: 'design', designSubTab: retired });
      await useSystemStore.persist.rehydrate();
      expect(useSystemStore.getState().designSubTab).toBe(expected);
    }
  });

  it("lands an unrecognised designSubTab on the manifest instead of blanking", async () => {
    // The case no remap table can cover: a value written by a NEWER build the
    // user rolled back from.
    seedPersistedSystemStore({ editorTab: 'design', designSubTab: 'from-the-future' });
    await useSystemStore.persist.rehydrate();
    expect(useSystemStore.getState().designSubTab).toBe('manifest');
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

  it("migrates legacy 'life' editorTab to design+manifest sub-tab", async () => {
    seedPersistedSystemStore({ editorTab: 'life' });
    await useSystemStore.persist.rehydrate();
    const state = useSystemStore.getState();
    expect(state.editorTab).toBe('design');
    expect(state.designSubTab).toBe('manifest');
  });
});

describe('systemStore onRehydrateStorage — sidebarSection membership', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetDedupCacheForTests();
    useSystemStore.setState({ sidebarSection: 'home', teamsTab: 'projects' });
  });

  it('keeps every section the registry declares', async () => {
    for (const id of ALL_SIDEBAR_SECTIONS) {
      localStorage.clear();
      _resetDedupCacheForTests();
      seedPersistedSystemStore({ sidebarSection: id });
      await useSystemStore.persist.rehydrate();
      expect(useSystemStore.getState().sidebarSection).toBe(id);
    }
  });

  it('lands an unknown persisted section on home instead of crashing the shell', async () => {
    // `navSection()` returns undefined for an id outside the registry, and
    // `isSectionGated` — the first statement of PersonasPage.renderContent —
    // throws reading `.gates`. The value is persisted, so before this guard
    // the crash survived a restart.
    seedPersistedSystemStore({ sidebarSection: 'pipeline' });
    await useSystemStore.persist.rehydrate();
    expect(useSystemStore.getState().sidebarSection).toBe('home');
  });

  it('migrates the retired `goals` section BEFORE the membership guard sees it', async () => {
    // Order matters: a value with a recorded successor must be migrated, not
    // discarded. `goals` is not in the registry, so a guard running first
    // would send the user to Home and drop the Goals tab.
    seedPersistedSystemStore({ sidebarSection: 'goals' });
    await useSystemStore.persist.rehydrate();
    const s = useSystemStore.getState();
    expect(s.sidebarSection).toBe('teams');
    expect(s.teamsTab).toBe('goals');
  });

  it('survives a persisted section that is not a string at all', async () => {
    seedPersistedSystemStore({ sidebarSection: 42 });
    await useSystemStore.persist.rehydrate();
    expect(useSystemStore.getState().sidebarSection).toBe('home');
  });
});

describe('systemStore onRehydrateStorage — Athena stops being a plugin', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetDedupCacheForTests();
    useSystemStore.setState({
      sidebarSection: 'home',
      pluginTab: 'browse',
      companionsPage: 'landing',
    });
  });

  it("moves a user parked on Plugins > Companion to the Companions section", async () => {
    // The REMAP, not a discard: someone whose last screen was Athena's page
    // must land on Athena's page, at its new address.
    seedPersistedSystemStore({
      sidebarSection: 'plugins',
      pluginTab: 'companion',
      companionPluginTab: 'memory',
    });
    await useSystemStore.persist.rehydrate();
    const s = useSystemStore.getState();
    expect(s.sidebarSection).toBe('companions');
    expect(s.companionsPage).toBe('athena:memory');
    // `companion` is no longer a PluginTab — leaving it would strand the
    // Plugins section on a tab nothing answers to the next time it opens.
    expect(s.pluginTab).toBe('browse');
  });

  it('migrates every retired companionPluginTab value onto its page', async () => {
    const cases: [string, string][] = [
      ['create-athena', 'athena:create-athena'],
      ['setup', 'athena:setup'],
      ['memory', 'athena:memory'],
      ['voice', 'athena:voice'],
      ['decisions', 'athena:decisions'],
    ];
    for (const [tab, expected] of cases) {
      localStorage.clear();
      _resetDedupCacheForTests();
      useSystemStore.setState({ companionsPage: 'landing' });
      seedPersistedSystemStore({ companionPluginTab: tab });
      await useSystemStore.persist.rehydrate();
      expect(useSystemStore.getState().companionsPage).toBe(expected);
    }
  });

  it('drops the retired field so it cannot shadow the new one later', async () => {
    seedPersistedSystemStore({ companionPluginTab: 'voice' });
    await useSystemStore.persist.rehydrate();
    expect(useSystemStore.getState()).not.toHaveProperty('companionPluginTab');
  });

  it('ignores a companionPluginTab value no page answers to', async () => {
    // A tab from a build that had one this one does not: there is no page to
    // land on, so the section's default is the honest destination.
    seedPersistedSystemStore({ companionPluginTab: 'dashboard' });
    await useSystemStore.persist.rehydrate();
    expect(useSystemStore.getState().companionsPage).toBe('landing');
  });

  it('leaves a plugins section that is NOT on companion alone', async () => {
    seedPersistedSystemStore({ sidebarSection: 'plugins', pluginTab: 'twin' });
    await useSystemStore.persist.rehydrate();
    const s = useSystemStore.getState();
    expect(s.sidebarSection).toBe('plugins');
    expect(s.pluginTab).toBe('twin');
  });

  it('keeps every page the current vocabulary declares', async () => {
    for (const page of COMPANIONS_PAGES) {
      localStorage.clear();
      _resetDedupCacheForTests();
      seedPersistedSystemStore({ companionsPage: page });
      await useSystemStore.persist.rehydrate();
      expect(useSystemStore.getState().companionsPage).toBe(page);
    }
  });

  it('lands an unknown companionsPage on the section default', async () => {
    seedPersistedSystemStore({ companionsPage: 'athena:from-the-future' });
    await useSystemStore.persist.rehydrate();
    expect(useSystemStore.getState().companionsPage).toBe('landing');
  });
});
