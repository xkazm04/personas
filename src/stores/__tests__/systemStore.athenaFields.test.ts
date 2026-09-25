import { describe, it, expect, beforeEach } from 'vitest';
import { useSystemStore } from '../systemStore';
import { _resetDedupCacheForTests } from '../util/dedupedStorage';
import { LEGACY_ATHENA_FIELDS, remapLegacyAthenaFields } from '../slices/system/athenaSlice';

/**
 * Athena's persisted UI fields were named `companion*` until the Companions
 * rename. An existing install has a `persona-ui-system` blob full of the old
 * names, so the persist `merge` step maps them onto the new ones — otherwise
 * every one of a user's settings (orb on/off, voice engine, STT model, panel
 * width, expanded alert kinds, …) silently reverts to its default on the
 * first launch after the upgrade.
 *
 * Fixture-driven on purpose: the blob below is the shape an OLD build wrote.
 */

const STORAGE_KEY = 'persona-ui-system';

const LEGACY_BLOB = {
  companionFooterEnabled: false,
  companionPanelCompact: true,
  companionSidePanelSlot: null,
  companionOrbEnabled: false,
  companionOrbPos: { x: 0, y: 0.25 },
  companionSttEngine: 'whisper',
  companionSttModelId: 'base.en',
  companionGlobalHotkeyEnabled: true,
  companionSoundEnabled: false,
  companionVoiceEnabled: true,
  companionVoiceEngine: 'pocket_tts',
  companionKokoroVoiceId: 'af_heart',
  companionPocketVoiceId: 'alba',
  companionVoiceSpeed: 0.9,
  companionVoiceVolume: 0.25,
  companionRecallSynthesisEnabled: true,
  companionAutonomousMode: true,
  companionDevMode: true,
  companionHandsFreeDecisions: true,
  companionAlertsExpanded: ['blocked', 'proactive'],
};

function seedPersistedSystemStore(state: Record<string, unknown>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, version: 0 }));
}

describe('legacy companion* -> athena* persisted-field remap', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetDedupCacheForTests();
  });

  it('covers every persisted field the rename touched', () => {
    expect(Object.keys(LEGACY_ATHENA_FIELDS)).toHaveLength(20);
    // The tab field is deliberately NOT remapped here — it is retired by the
    // Companions navigation change, which migrates it once.
    expect(LEGACY_ATHENA_FIELDS).not.toHaveProperty('companionPluginTab');
  });

  it('carries every old value onto the new field name', () => {
    const out = remapLegacyAthenaFields(LEGACY_BLOB);
    expect(out.athenaFooterEnabled).toBe(false);
    expect(out.athenaPanelCompact).toBe(true);
    expect(out.athenaOrbPos).toEqual({ x: 0, y: 0.25 });
    expect(out.athenaSttEngine).toBe('whisper');
    expect(out.athenaVoiceEngine).toBe('pocket_tts');
    expect(out.athenaVoiceVolume).toBe(0.25);
    expect(out.athenaAlertsExpanded).toEqual(['blocked', 'proactive']);
    // and the legacy names are gone, so they cannot shadow anything later
    expect(out).not.toHaveProperty('companionOrbEnabled');
  });

  it('rehydrates a real legacy blob into the renamed state', async () => {
    seedPersistedSystemStore(LEGACY_BLOB);
    await useSystemStore.persist.rehydrate();
    const s = useSystemStore.getState();
    expect(s.athenaOrbEnabled).toBe(false);
    expect(s.athenaFooterEnabled).toBe(false);
    expect(s.athenaSttModelId).toBe('base.en');
    expect(s.athenaVoiceSpeed).toBe(0.9);
    expect(s.athenaDevMode).toBe(true);
    expect(s.athenaAlertsExpanded).toEqual(['blocked', 'proactive']);
  });

  it('prefers a new-name value when a blob somehow carries both', async () => {
    seedPersistedSystemStore({ companionOrbEnabled: false, athenaOrbEnabled: true });
    await useSystemStore.persist.rehydrate();
    expect(useSystemStore.getState().athenaOrbEnabled).toBe(true);
  });

  it('leaves a blob with no legacy fields untouched', () => {
    const blob = { athenaOrbEnabled: false, sidebarSection: 'home' };
    expect(remapLegacyAthenaFields(blob)).toEqual(blob);
  });

  it('survives a non-object persisted blob', () => {
    expect(remapLegacyAthenaFields(null)).toEqual({});
    expect(remapLegacyAthenaFields('nonsense')).toEqual({});
  });
});
