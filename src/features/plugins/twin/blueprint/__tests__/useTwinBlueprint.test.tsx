/**
 * The blueprint model is built from what the app already holds plus a few pure
 * reads, and building it must never start LLM work: `setupOpen` (which can
 * start a paid deep plan) is never called, only `setupGet`. A read that fails
 * leaves its counts `null`, never `0`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import type { SetupSessionSnapshot } from '@/lib/bindings/SetupSessionSnapshot';
import type { SetupStep } from '@/lib/bindings/SetupStep';
import type { TwinPendingMemory } from '@/lib/bindings/TwinPendingMemory';
import type { TwinTone } from '@/lib/bindings/TwinTone';

const { setupGet, setupOpen, listPendingMemories, listDistilledFacts, listCommunications, sampleProposals } = vi.hoisted(() => ({
  setupGet: vi.fn(),
  setupOpen: vi.fn(),
  listPendingMemories: vi.fn(),
  listDistilledFacts: vi.fn(),
  listCommunications: vi.fn(),
  sampleProposals: vi.fn(),
}));

vi.mock('@/api/twin/twinSetup', () => ({ setupGet, setupOpen }));
vi.mock('@/api/twin/twin', () => ({ listPendingMemories, listDistilledFacts, listCommunications }));
vi.mock('@/api/twin/twinSample', () => ({ sampleProposals }));
vi.mock('@/lib/silentCatch', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/silentCatch');
  return { ...actual, silentCatch: () => () => {} };
});

const PRESET = JSON.stringify({ source: 'preset', presetId: 'p1', name: 'Plain', summary: '', avoid: '', dims: { formality: 3, warmth: 3, humor: 2, energy: 3, length: 2, directness: 4, expressiveness: 2, detail: 3 } });
const LEARNED = JSON.stringify({ source: 'learned', presetId: null, name: 'Learned', summary: '', avoid: '', dims: { formality: 4, warmth: 3, humor: 1, energy: 3, length: 3, directness: 3, expressiveness: 2, detail: 4 } });

function tone(channel: string, over: Partial<TwinTone> = {}): TwinTone {
  return { id: `tone-${channel}`, twin_id: 't1', channel, voice_directives: '', examples_json: null, constraints_json: null, length_hint: null, style_json: null, updated_at: '', ...over };
}

function memory(id: string, status: string, over: Partial<TwinPendingMemory> = {}): TwinPendingMemory {
  return { id, twin_id: 't1', channel: null, content: `memory ${id}`, title: null, importance: 3, status, reviewer_notes: null, source_communication_id: null, created_at: '2026-09-30T10:00:00Z', reviewed_at: null, ...over };
}

const state = {
  activeTwinId: 't1',
  twinProfiles: [
    { id: 't1', name: 'Marek', slug: 'marek', bio: 'Engineering lead who writes short, direct replies to everyone.', role: 'Engineering lead', languages: '["cs","en"]', pronouns: null, obsidian_subpath: 'personas/twins/marek', is_active: true, knowledge_base_id: null, training_directives: null, created_at: '', updated_at: '' },
  ],
  twinTones: [
    tone('generic', { voice_directives: 'Short and direct.', examples_json: '["Sure, ship it."]', constraints_json: '["No emoji","No sign-off"]', style_json: PRESET }),
    tone('email', { voice_directives: 'One ask per mail.', style_json: LEARNED }),
    tone('slack', { examples_json: '["on it"]' }),
    tone('generic', { twin_id: 'other' }),
  ],
  twinChannels: [{ id: 'c1', twin_id: 't1', channel_type: 'discord', credential_id: 'cr', persona_id: null, label: null, is_active: true, created_at: '', updated_at: '' }],
  twinReadinessApproved: [memory('a1', 'approved'), memory('a2', 'approved')],
};

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: <T,>(selector: (s: typeof state) => T): T => selector(state),
}));

function step(id: string, kind: string, over: Partial<SetupStep> = {}): SetupStep {
  return { id, goalId: 'g1', stage: 'setup', origin: 'plan', kind, question: `q ${id}`, answerMode: 'pick', incoming: null, toneChannel: null, suggestions: [], status: 'answered', answer: 'a', position: 0, askedAt: null, answeredAt: '2026-09-30T18:20:00Z', reconciled: true, coverageGain: null, ...over };
}

const SNAPSHOT: SetupSessionSnapshot = {
  twinId: 't1', stage: 'setup', topicPreset: null, focusSlot: null, planStatus: 'ready', planVersion: 2, planError: null, changeNote: null,
  goals: [
    { id: 'g1', slot: 'identity', title: 'Who Marek is at work', intent: '', criteria: ['Role'], state: 'covered', pinned: false, coverage: 0.9, position: 0, answered: 4, lastWhy: null },
    { id: 'g7', slot: 'training:opinions', title: 'How Marek argues', intent: '', criteria: [], state: 'open', pinned: false, coverage: 1.4, position: 1, answered: 2, lastWhy: 'Took a side.' },
  ],
  live: null,
  upcoming: [],
  transcript: [step('s1', 'scene'), step('s2', 'scene'), step('s3', 'opinion'), step('s4', 'fact', { status: 'skipped', answer: null })],
  offers: [], lastAnswerOfferIds: [],
  observations: [{ id: 'o1', text: 'Short lines.', evidence: 2, updatedAt: '' }],
  planning: false, reconciling: false,
};

import { useTwinBlueprint } from '../useTwinBlueprint';
import { deriveReadiness } from '../../useTwinReadiness';

beforeEach(() => {
  vi.clearAllMocks();
  setupGet.mockResolvedValue(SNAPSHOT);
  listPendingMemories.mockImplementation(async (_id: string, status: string) =>
    status === 'approved' ? [memory('a1', 'approved'), memory('a2', 'approved')] : status === 'pending' ? [memory('p1', 'pending')] : [],
  );
  listDistilledFacts.mockResolvedValue([
    { id: 'f1', twin_id: 't1', contact_handle: null, content: 'Lives in Brno', importance: 3, sources_json: '["c"]', created_at: '', last_seen_at: '' },
    { id: 'f2', twin_id: 't1', contact_handle: 'alice@discord', content: 'Alice prefers DMs', importance: 3, sources_json: '["c"]', created_at: '', last_seen_at: '' },
  ]);
  listCommunications.mockResolvedValue([]);
  sampleProposals.mockRejectedValue(new Error('not built'));
});

describe('useTwinBlueprint', () => {
  it('builds the model from the store and setupGet, and never opens a session', async () => {
    const { result } = renderHook(() => useTwinBlueprint('t1'));
    expect(result.current.model).toBeNull();
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.model).not.toBeNull());
    const model = result.current.model!;

    expect(setupOpen).not.toHaveBeenCalled();
    expect(setupGet).toHaveBeenCalledTimes(1);
    expect(setupGet).toHaveBeenCalledWith('t1');
    expect(result.current.loading).toBe(false);

    expect(model.identity).toEqual({ name: 'Marek', role: 'Engineering lead', bioChars: 62, bioTarget: 50, languages: ['cs', 'en'] });
    expect(model.voice.channels.map((c) => [c.channel, c.origin])).toEqual([
      ['generic', 'preset'], ['discord', null], ['email', 'learned'], ['slack', 'manual'],
    ]);
    expect(model.voice.channels[0]).toMatchObject({ exemplars: 1, rules: 2, hasDirectives: true });
    expect(model.voice.channels[3]).toMatchObject({ exemplars: 1, rules: 0, hasDirectives: false, dims: null });

    expect(model.knowledge).toEqual({ memories: { approved: 2, pending: 1, rejected: 0 }, facts: 1, kbBound: false });
    expect(model.training.goals.map((g) => [g.id, g.coverage, g.lastWhy])).toEqual([['g1', 0.9, null], ['g7', 1, 'Took a side.']]);
    expect(model.training.answered).toBe(6);
    expect(model.training.kindMix).toEqual({ scene: 2, opinion: 1 });
    expect(model.training.observations).toBe(1);
    expect(model.training.lastTrainedAt).toBe('2026-09-30T18:20:00Z');
    expect(model.training.topics).toHaveLength(6);

    const readiness = deriveReadiness(state.twinProfiles[0], state.twinTones.slice(0, 3), state.twinChannels, state.twinReadinessApproved);
    expect(model.readiness.score).toBe(readiness.score);
    expect(model.readiness.slots).toEqual({ identity: 'set', tone: 'set', channels: 'set', memories: 'partial' });
  });

  it('a read that fails is null, never 0, and the rest of the model stands', async () => {
    listPendingMemories.mockRejectedValue(new Error('db locked'));
    listDistilledFacts.mockRejectedValue(new Error('db locked'));
    const { result } = renderHook(() => useTwinBlueprint('t1'));
    await waitFor(() => expect(result.current.model).not.toBeNull());
    const model = result.current.model!;
    expect(model.knowledge.memories).toEqual({ approved: null, pending: null, rejected: null });
    expect(model.knowledge.facts).toBeNull();
    // The samples backend answers "not built" until it lands: absent, not none.
    expect(model.samples.open).toBeNull();
    expect(model.training.goals).toHaveLength(2);
    expect(setupOpen).not.toHaveBeenCalled();
  });

  it('counts open sample proposals once the command answers', async () => {
    sampleProposals.mockResolvedValue([{ id: 'sp1' }, { id: 'sp2' }]);
    const { result } = renderHook(() => useTwinBlueprint('t1'));
    await waitFor(() => expect(result.current.model?.samples.open).toBe(2));
    expect(sampleProposals).toHaveBeenCalledWith('t1', 'open');
  });

  it('uses a snapshot the caller already holds instead of reading one', async () => {
    const held = { ...SNAPSHOT, goals: [SNAPSHOT.goals[0]!] };
    const { result } = renderHook(() => useTwinBlueprint('t1', { snapshot: held }));
    await waitFor(() => expect(result.current.model).not.toBeNull());
    expect(setupGet).not.toHaveBeenCalled();
    expect(setupOpen).not.toHaveBeenCalled();
    expect(result.current.model!.training.goals.map((g) => g.id)).toEqual(['g1']);
  });

  it('a refresh re-reads while the model it has stays on screen', async () => {
    const { result, rerender } = renderHook(({ key }) => useTwinBlueprint('t1', { refreshKey: key }), { initialProps: { key: 0 } });
    await waitFor(() => expect(result.current.model).not.toBeNull());
    const first = result.current.model;
    setupGet.mockReturnValue(new Promise(() => {}));
    rerender({ key: 1 });
    expect(setupGet).toHaveBeenCalledTimes(2);
    expect(result.current.model).toBe(first);
    expect(result.current.loading).toBe(false);
  });

  it('no twin, no model and no reads', () => {
    const { result } = renderHook(() => useTwinBlueprint(null));
    expect(result.current.model).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(setupGet).not.toHaveBeenCalled();
  });
});
