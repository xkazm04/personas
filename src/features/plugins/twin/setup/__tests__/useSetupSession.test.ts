/**
 * useSetupSession as a thin client over the persisted setup session.
 *
 * `@/api/twin/twinSetup` is mocked (the backend owns the plan and the queue);
 * the i18n layer is NOT — the opener comes from the real catalog, so a missing
 * key fails here rather than rendering `undefined` to the person.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { TwinProfile } from '@/lib/bindings/TwinProfile';
import type { TwinTone } from '@/lib/bindings/TwinTone';
import type { TwinChannel } from '@/lib/bindings/TwinChannel';
import type { TwinPendingMemory } from '@/lib/bindings/TwinPendingMemory';
import type { SetupSessionSnapshot } from '@/lib/bindings/SetupSessionSnapshot';
import type { SetupStep } from '@/lib/bindings/SetupStep';
import type { SetupOffer } from '@/lib/bindings/SetupOffer';
import type { SetupUpdatedEvent } from '@/lib/bindings/SetupUpdatedEvent';

// ---------------------------------------------------------------------------
// Mocks — before the module under test is imported.
// ---------------------------------------------------------------------------

const api = vi.hoisted(() => ({
  setupGet: vi.fn(),
  setupOpen: vi.fn(),
  setupAnswer: vi.fn(),
  setupSteer: vi.fn(),
  setupOfferVerdict: vi.fn(),
  setupRebuild: vi.fn(),
}));
vi.mock('@/api/twin/twinSetup', () => api);

/** The one `twin-setup-updated` handler the hook registered, if any. */
const events = vi.hoisted(() => ({
  handler: null as null | ((payload: SetupUpdatedEvent) => void),
  unlisten: vi.fn(),
}));
vi.mock('@/lib/eventRegistry', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/eventRegistry');
  return {
    ...actual,
    typedListen: vi.fn(async (_name: string, handler: (payload: SetupUpdatedEvent) => void) => {
      events.handler = handler;
      return events.unlisten;
    }),
  };
});

const mockUpdateTwinProfile = vi.fn().mockResolvedValue(undefined);
const mockUpsertTwinTone = vi.fn().mockResolvedValue({});
const mockSetPendingTrainingQuestions = vi.fn();

let storeState: Record<string, unknown> = {};
vi.mock('@/stores/systemStore', () => {
  const useSystemStore = <T,>(selector: (s: Record<string, unknown>) => T): T =>
    selector(storeState);
  return { useSystemStore };
});

vi.mock('@/lib/silentCatch', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/silentCatch');
  return { ...actual, toastCatch: () => () => {}, silentCatch: () => () => {} };
});

import { typedListen } from '@/lib/eventRegistry';
import { useSetupSession } from '../useSetupSession';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProfile(over: Partial<TwinProfile> = {}): TwinProfile {
  return {
    id: 't1',
    name: 'Test Twin',
    slug: 'test-twin',
    bio: null,
    role: null,
    languages: null,
    pronouns: null,
    obsidian_subpath: 'personas/twins/test-twin',
    is_active: true,
    knowledge_base_id: null,
    training_directives: null,
    created_at: '',
    updated_at: '',
    ...over,
  };
}

function makeTone(over: Partial<TwinTone> = {}): TwinTone {
  return {
    id: 'tn1',
    twin_id: 't1',
    channel: 'generic',
    voice_directives: 'Short and dry.',
    examples_json: null,
    constraints_json: null,
    length_hint: null,
    updated_at: '',
    ...over,
  };
}

function makeChannel(over: Partial<TwinChannel> = {}): TwinChannel {
  return {
    id: 'c1',
    twin_id: 't1',
    channel_type: 'discord',
    credential_id: 'cred',
    persona_id: null,
    label: null,
    is_active: true,
    created_at: '',
    updated_at: '',
    ...over,
  };
}

function makeMemory(over: Partial<TwinPendingMemory> = {}): TwinPendingMemory {
  return {
    id: 'm1',
    twin_id: 't1',
    channel: null,
    content: 'x',
    title: null,
    importance: 3,
    status: 'approved',
    reviewer_notes: null,
    source_communication_id: null,
    created_at: '',
    reviewed_at: null,
    ...over,
  };
}

function step(over: Partial<SetupStep> = {}): SetupStep {
  return {
    id: 's1',
    goalId: null,
    stage: 'setup',
    origin: 'plan',
    kind: 'opinion',
    question: 'What are you known for?',
    answerMode: 'pick',
    incoming: null,
    toneChannel: null,
    suggestions: [{ text: 'Shipping things', reason: 'Matches the bio.' }],
    status: 'live',
    answer: null,
    position: 0,
    askedAt: '2026-09-24 10:00:00',
    answeredAt: null,
    reconciled: false,
    ...over,
  };
}

function offer(over: Partial<SetupOffer> = {}): SetupOffer {
  return {
    id: 'o1',
    stepId: 's0',
    origin: 'reconcile',
    kind: 'bio',
    part: null,
    channel: null,
    value: 'Builds local-first tools.',
    lengthHint: null,
    reason: 'From what they said.',
    status: 'open',
    ...over,
  };
}

function snap(over: Partial<SetupSessionSnapshot> = {}): SetupSessionSnapshot {
  return {
    twinId: 't1',
    stage: 'setup',
    topicPreset: null,
    focusSlot: null,
    planStatus: 'ready',
    planVersion: 1,
    planError: null,
    changeNote: null,
    goals: [],
    live: step(),
    upcoming: [],
    transcript: [],
    offers: [],
    lastAnswerOfferIds: [],
    observations: [],
    planning: false,
    reconciling: false,
    ...over,
  };
}

function setStore(over: Record<string, unknown> = {}) {
  storeState = {
    activeTwinId: 't1',
    twinProfiles: [makeProfile()],
    twinTones: [],
    twinChannels: [],
    twinReadinessApproved: [],
    updateTwinProfile: mockUpdateTwinProfile,
    upsertTwinTone: mockUpsertTwinTone,
    pendingTrainingQuestions: null,
    setPendingTrainingQuestions: mockSetPendingTrainingQuestions,
    ...over,
  };
}

/** Mount and wait for the open to land. */
async function mounted() {
  const hook = renderHook(() => useSetupSession());
  await waitFor(() => expect(hook.result.current.question).not.toBeNull());
  return hook;
}

beforeEach(() => {
  vi.clearAllMocks();
  events.handler = null;
  const initial = snap();
  api.setupOpen.mockResolvedValue(initial);
  api.setupGet.mockResolvedValue(initial);
  api.setupAnswer.mockResolvedValue(initial);
  api.setupSteer.mockResolvedValue(initial);
  api.setupOfferVerdict.mockResolvedValue(initial);
  api.setupRebuild.mockResolvedValue(initial);
  mockUpdateTwinProfile.mockResolvedValue(undefined);
  mockUpsertTwinTone.mockResolvedValue({});
  setStore();
});

// ---------------------------------------------------------------------------
// Open and resume
// ---------------------------------------------------------------------------

describe('useSetupSession — open and resume', () => {
  it('subscribes, then opens exactly once with the readiness and a setup opener', async () => {
    const { result } = await mounted();

    expect(events.handler).not.toBeNull();
    expect(api.setupOpen).toHaveBeenCalledTimes(1);
    // The listener is registered before the open is sent, so nothing the
    // engine announces between the two can be missed.
    expect(vi.mocked(typedListen).mock.invocationCallOrder[0]!).toBeLessThan(
      api.setupOpen.mock.invocationCallOrder[0]!,
    );
    const [twinId, readiness, locale, opener] = api.setupOpen.mock.calls[0]!;
    expect(twinId).toBe('t1');
    expect(readiness).toEqual({ identity: 'empty', tone: 'empty', channels: 'empty', memories: 'empty' });
    expect(typeof locale).toBe('string');
    // The opener is the real catalog's line for the first open slot.
    expect(opener).toEqual({ slot: 'identity', question: expect.any(String) });
    expect((opener as { question: string }).question.length).toBeGreaterThan(0);

    expect(result.current.question).toBe('What are you known for?');
    expect(result.current.suggestions).toEqual([{ text: 'Shipping things', reason: 'Matches the bio.' }]);
  });

  it('a remount resumes with another open and never answers or rebuilds', async () => {
    const first = await mounted();
    first.unmount();
    expect(events.unlisten).toHaveBeenCalled();

    const second = await mounted();
    expect(api.setupOpen).toHaveBeenCalledTimes(2);
    expect(api.setupAnswer).not.toHaveBeenCalled();
    expect(api.setupRebuild).not.toHaveBeenCalled();
    expect(second.result.current.question).toBe('What are you known for?');
  });

  it('sends readiness from stored rows — the planner plans against what is filled', async () => {
    setStore({
      twinProfiles: [
        makeProfile({ bio: 'I build local-first developer tools and I write about the parts that go wrong.' }),
      ],
      twinTones: [makeTone()],
    });
    await mounted();
    expect(api.setupOpen.mock.calls[0]![1]).toEqual({
      identity: 'set',
      tone: 'partial',
      channels: 'empty',
      memories: 'empty',
    });
    // Identity is set, so the opener asks the first slot that is not.
    expect(api.setupOpen.mock.calls[0]![3]).toMatchObject({ slot: 'tone' });
  });

  it('a training request opens with no opener and steers to training once', async () => {
    api.setupOpen.mockResolvedValue(snap({ stage: 'setup', live: null }));
    api.setupSteer.mockResolvedValue(snap({ stage: 'training' }));
    const { result } = renderHook(() => {
      const session = useSetupSession();
      return session;
    });
    // The entry point's request lands in the same commit as the mount.
    act(() => result.current.setStage('training'));

    await waitFor(() => expect(result.current.stage).toBe('training'));
    expect(api.setupOpen.mock.calls[0]![3]).toBeNull();
    expect(api.setupSteer).toHaveBeenCalledTimes(1);
    expect(api.setupSteer.mock.calls[0]![1]).toEqual({ action: 'setStage', stage: 'training' });
  });

  it('asking for the stage already stored sends nothing', async () => {
    const { result } = await mounted();
    await act(async () => {
      result.current.setStage('setup');
    });
    expect(api.setupSteer).not.toHaveBeenCalled();
  });

  it('an update event refetches the snapshot and renders it', async () => {
    const { result } = await mounted();
    api.setupGet.mockResolvedValue(
      snap({ offers: [offer()], lastAnswerOfferIds: ['o1'] }),
    );
    await act(async () => {
      events.handler?.({ twinId: 't1', reason: 'reconciled', planVersion: 1 });
    });
    await waitFor(() => expect(result.current.proposals).toHaveLength(1));
    expect(api.setupGet).toHaveBeenCalledWith('t1');
    expect(result.current.lastAnswerOfferIds).toEqual(['o1']);
  });

  it("another twin's event is ignored", async () => {
    await mounted();
    await act(async () => {
      events.handler?.({ twinId: 't2', reason: 'reconciled', planVersion: 1 });
    });
    expect(api.setupGet).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Answering
// ---------------------------------------------------------------------------

describe('useSetupSession — answer and skip', () => {
  it('answers the LIVE step id and renders the next step from the reply', async () => {
    const { result } = await mounted();
    api.setupAnswer.mockResolvedValue(
      snap({
        live: step({ id: 's2', question: 'Who do you write for?' }),
        transcript: [step({ status: 'answered', answer: 'Shipping things' })],
        reconciling: true,
      }),
    );

    await act(async () => {
      await result.current.answer('  Shipping things  ');
    });

    expect(api.setupAnswer).toHaveBeenCalledWith('t1', 's1', 'Shipping things', expect.any(Object), expect.any(String));
    expect(result.current.question).toBe('Who do you write for?');
    // The next question is already there, so the table is not busy while the
    // answer is read in the background.
    expect(result.current.busy).toBe(false);
    expect(result.current.reconciling).toBe(true);
    expect(result.current.history.map((h) => [h.role, h.text])).toEqual([
      ['guide', 'What are you known for?'],
      ['user', 'Shipping things'],
      ['guide', 'Who do you write for?'],
    ]);
  });

  it('skip answers the live step with null and stores no value', async () => {
    const { result } = await mounted();
    api.setupAnswer.mockResolvedValue(
      snap({
        live: step({ id: 's2', question: 'Something else, then?' }),
        transcript: [step({ status: 'skipped' })],
      }),
    );
    await act(async () => {
      await result.current.skip();
    });
    expect(api.setupAnswer).toHaveBeenCalledWith('t1', 's1', null, expect.any(Object), expect.any(String));
    expect(mockUpdateTwinProfile).not.toHaveBeenCalled();
    expect(mockUpsertTwinTone).not.toHaveBeenCalled();
    // A declined question is a guide line with no user line after it.
    expect(result.current.history.map((h) => h.role)).toEqual(['guide', 'guide']);
  });

  it('is busy only with no live step and background work in flight', async () => {
    api.setupOpen.mockResolvedValue(snap({ live: null, planning: true, planStatus: 'building' }));
    const { result } = renderHook(() => useSetupSession());
    await waitFor(() => expect(api.setupOpen).toHaveBeenCalled());
    await waitFor(() => expect(result.current.plan?.status).toBe('building'));
    expect(result.current.busy).toBe(true);
    expect(result.current.question).toBeNull();
  });

  it('a failed answer sets generatorError, keeps the question and leaves typed edits working', async () => {
    const { result } = await mounted();
    api.setupAnswer.mockRejectedValue(new Error('Claude CLI returned non-zero exit code'));
    await act(async () => {
      await result.current.answer('an answer');
    });
    expect(result.current.generatorError).not.toBeNull();
    expect(result.current.question).toBe('What are you known for?');
    expect(result.current.checklist.every((c) => c.status === 'empty')).toBe(true);

    await act(async () => {
      await result.current.edit({ field: 'bio', value: 'I build local-first tools.' });
    });
    expect(mockUpdateTwinProfile).toHaveBeenCalledWith('t1', { bio: 'I build local-first tools.' });

    // The next successful mutation clears it.
    api.setupAnswer.mockResolvedValue(snap());
    await act(async () => {
      await result.current.answer('again');
    });
    expect(result.current.generatorError).toBeNull();
  });

  it('a failed plan with nothing live reads as the guide being down', async () => {
    api.setupOpen.mockResolvedValue(snap({ live: null, planStatus: 'failed', planError: 'boom' }));
    const { result } = renderHook(() => useSetupSession());
    await waitFor(() => expect(result.current.generatorError).not.toBeNull());
    expect(result.current.busy).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Offers: the write stays here, the verdict goes to the server
// ---------------------------------------------------------------------------

describe('useSetupSession — offers', () => {
  it('maps open offers to proposals and stamps them on their step with verdicts', async () => {
    api.setupOpen.mockResolvedValue(
      snap({
        transcript: [step({ id: 's0', status: 'answered', answer: 'I build tools' })],
        offers: [offer(), offer({ id: 'o2', kind: 'role', value: 'Founder', status: 'dismissed' })],
      }),
    );
    const { result } = await mounted();
    expect(result.current.proposals.map((p) => p.id)).toEqual(['o1']);
    expect(result.current.offerRecord.map((v) => [v.proposal.id, v.resolution])).toEqual([
      ['o1', null],
      ['o2', 'dismissed'],
    ]);
    const guide = result.current.history.find((h) => h.id === 'g-s0');
    expect(guide?.proposals?.map((p) => p.id)).toEqual(['o1', 'o2']);
    expect(guide?.resolutions).toEqual({ o2: 'dismissed' });
  });

  it('arriving writes nothing', async () => {
    api.setupOpen.mockResolvedValue(snap({ offers: [offer()] }));
    await mounted();
    expect(mockUpdateTwinProfile).not.toHaveBeenCalled();
    expect(mockUpsertTwinTone).not.toHaveBeenCalled();
  });

  it('accept writes the field, then records the accepted verdict', async () => {
    api.setupOpen.mockResolvedValue(snap({ offers: [offer()] }));
    const { result } = await mounted();
    api.setupOfferVerdict.mockResolvedValue(snap({ offers: [offer({ status: 'accepted' })] }));

    await act(async () => {
      await result.current.accept(result.current.proposals[0]!);
    });

    expect(mockUpdateTwinProfile).toHaveBeenCalledWith('t1', { bio: 'Builds local-first tools.' });
    expect(api.setupOfferVerdict).toHaveBeenCalledWith('t1', 'o1', 'accepted');
    expect(result.current.proposals).toEqual([]);
    expect(result.current.offerRecord[0]?.resolution).toBe('accepted');
  });

  it('a failed write records no verdict', async () => {
    api.setupOpen.mockResolvedValue(snap({ offers: [offer()] }));
    const { result } = await mounted();
    mockUpdateTwinProfile.mockRejectedValueOnce(new Error('db locked'));
    await act(async () => {
      await result.current.accept(result.current.proposals[0]!);
    });
    expect(api.setupOfferVerdict).not.toHaveBeenCalled();
  });

  it('accept routes a tone offer to its own channel', async () => {
    setStore({ twinChannels: [makeChannel({ channel_type: 'discord' })] });
    api.setupOpen.mockResolvedValue(
      snap({
        offers: [
          offer({ kind: 'tone', part: 'voice', channel: 'discord', value: 'lowercase, one line', lengthHint: '1-2 sentences' }),
        ],
      }),
    );
    const { result } = await mounted();
    await act(async () => {
      await result.current.accept(result.current.proposals[0]!);
    });
    expect(mockUpsertTwinTone).toHaveBeenCalledWith('t1', 'discord', 'lowercase, one line', null, null, '1-2 sentences');
  });

  it('an accepted rule is appended to the constraints and carries the rest of the row', async () => {
    setStore({
      twinTones: [makeTone({ channel: 'email', voice_directives: 'Short.', constraints_json: '["Always sign off with M"]' })],
    });
    api.setupOpen.mockResolvedValue(
      snap({ offers: [offer({ kind: 'tone', part: 'constraints', channel: 'email', value: 'Never book a time unasked.' })] }),
    );
    const { result } = await mounted();
    await act(async () => {
      await result.current.accept(result.current.proposals[0]!);
    });
    expect(mockUpsertTwinTone).toHaveBeenCalledWith(
      't1',
      'email',
      'Short.',
      null,
      '["Always sign off with M","Never book a time unasked."]',
      null,
    );
  });

  it('dismiss records the verdict and writes nothing', async () => {
    api.setupOpen.mockResolvedValue(snap({ offers: [offer()] }));
    const { result } = await mounted();
    await act(async () => {
      result.current.dismiss(result.current.proposals[0]!);
    });
    await waitFor(() => expect(api.setupOfferVerdict).toHaveBeenCalledWith('t1', 'o1', 'dismissed'));
    expect(mockUpdateTwinProfile).not.toHaveBeenCalled();
  });

  it('a typed edit marks the open offer for the same slot edited', async () => {
    api.setupOpen.mockResolvedValue(snap({ offers: [offer(), offer({ id: 'o2', kind: 'role', value: 'Founder' })] }));
    const { result } = await mounted();
    await act(async () => {
      await result.current.edit({ field: 'bio', value: 'My own words.' });
    });
    expect(mockUpdateTwinProfile).toHaveBeenCalledWith('t1', { bio: 'My own words.' });
    expect(api.setupOfferVerdict).toHaveBeenCalledTimes(1);
    expect(api.setupOfferVerdict).toHaveBeenCalledWith('t1', 'o1', 'edited');
  });

  it('a tone edit writes ONE part and carries the rest of the row over', async () => {
    setStore({
      twinTones: [
        makeTone({
          voice_directives: 'lowercase, no emoji',
          examples_json: '["ship it"]',
          constraints_json: '["never apologise twice"]',
          length_hint: '1-2 sentences',
        }),
      ],
    });
    const { result } = await mounted();
    await act(async () => {
      await result.current.edit({ field: 'tone', channel: 'generic', part: 'examples', value: '["ship it","on it"]' });
    });
    expect(mockUpsertTwinTone).toHaveBeenCalledWith(
      't1',
      'generic',
      'lowercase, no emoji',
      '["ship it","on it"]',
      '["never apologise twice"]',
      '1-2 sentences',
    );
  });
});

// ---------------------------------------------------------------------------
// Steering
// ---------------------------------------------------------------------------

describe('useSetupSession — steering', () => {
  it('redeal, focus, topic, steer and rebuild each send one command', async () => {
    const { result } = await mounted();
    await act(async () => {
      result.current.redeal();
      result.current.focusOn('tone');
      result.current.setTopic('Ask me about my work.', 'background');
      await result.current.steer({ action: 'pinGoal', goalId: 'g1', pinned: true });
      await result.current.rebuild();
    });
    expect(api.setupSteer.mock.calls.map((c) => c[1])).toEqual([
      { action: 'redeal' },
      { action: 'focusSlot', slot: 'tone' },
      { action: 'setTopic', presetId: 'background', prompt: 'Ask me about my work.' },
      { action: 'pinGoal', goalId: 'g1', pinned: true },
    ]);
    expect(api.setupRebuild).toHaveBeenCalledTimes(1);
  });

  it('a click on the slot already being asked is not a new instruction', async () => {
    const { result } = await mounted();
    await act(async () => {
      result.current.focusOn('identity');
    });
    expect(api.setupSteer).not.toHaveBeenCalled();
  });

  it('the topic is the preset prompt from the snapshot', async () => {
    api.setupOpen.mockResolvedValue(snap({ stage: 'training', topicPreset: 'background' }));
    const { result } = await mounted();
    expect(result.current.stage).toBe('training');
    expect(result.current.topicPreset).toBe('background');
    expect(typeof result.current.topic).toBe('string');
    expect(result.current.topic?.length).toBeGreaterThan(0);
  });

  it('focus follows the plan, and falls back to the first open slot', async () => {
    api.setupOpen.mockResolvedValue(snap({ focusSlot: 'channels' }));
    const { result } = await mounted();
    expect(result.current.focus).toBe('channels');
  });

  it('the Hub handoff joins the queue behind the open, then clears', async () => {
    setStore({ pendingTrainingQuestions: ['a?', 'b?', 'c?', 'd?', 'e?', 'f?'] });
    await mounted();
    await waitFor(() => expect(api.setupSteer).toHaveBeenCalled());
    expect(api.setupSteer.mock.calls[0]![1]).toEqual({
      action: 'enqueueHandoff',
      questions: ['a?', 'b?', 'c?', 'd?', 'e?'],
    });
    expect(mockSetPendingTrainingQuestions).toHaveBeenCalledWith(null);
    // Behind the open: the session exists before anything is queued on it.
    expect(api.setupOpen.mock.invocationCallOrder[0]!).toBeLessThan(api.setupSteer.mock.invocationCallOrder[0]!);
  });
});

// ---------------------------------------------------------------------------
// Readiness stays the completion authority
// ---------------------------------------------------------------------------

describe('useSetupSession — readiness is the completion authority', () => {
  it('derives the checklist from stored rows, whatever the plan says', async () => {
    api.setupOpen.mockResolvedValue(
      snap({
        goals: [
          {
            id: 'g1',
            slot: 'identity',
            title: 'Who they are',
            intent: '',
            criteria: [],
            state: 'covered',
            pinned: false,
            coverage: 1,
            position: 0,
            answered: 4,
          },
        ],
      }),
    );
    const { result } = await mounted();
    expect(result.current.checklist.map((c) => c.status)).toEqual(['empty', 'empty', 'empty', 'empty']);
    expect(result.current.score).toBe(0);
  });

  it('moves the checklist when the STORE changes', async () => {
    setStore({
      twinProfiles: [
        makeProfile({ bio: 'I build local-first developer tools and I write about the parts that go wrong.' }),
      ],
      twinTones: [makeTone(), makeTone({ id: 'tn2', channel: 'discord' })],
      twinChannels: [makeChannel()],
      twinReadinessApproved: Array.from({ length: 5 }, (_, i) => makeMemory({ id: `m${i}` })),
    });
    const { result } = await mounted();
    expect(result.current.checklist.map((c) => c.status)).toEqual(['set', 'set', 'set', 'set']);
    // 80, not 100: the fifth milestone (Brain) is not one of Setup's slots.
    expect(result.current.score).toBe(80);
  });

  it("exposes 'generic' plus every bound channel type and every tone row as the tone slots", async () => {
    setStore({
      twinChannels: [
        makeChannel({ channel_type: 'discord' }),
        makeChannel({ id: 'c2', channel_type: 'email' }),
        makeChannel({ id: 'c3', channel_type: 'discord' }),
      ],
      twinTones: [makeTone({ channel: 'slack' })],
    });
    const { result } = await mounted();
    expect(result.current.toneChannels).toEqual(['generic', 'discord', 'email', 'slack']);
  });

  it('opens the typed fields on what is stored', async () => {
    setStore({
      twinProfiles: [makeProfile({ role: 'Founder', bio: 'I ship.' })],
      twinTones: [makeTone({ channel: 'discord', voice_directives: 'Lowercase, no emoji.' })],
      twinChannels: [makeChannel({ channel_type: 'discord' })],
    });
    const { result } = await mounted();
    expect(result.current.values.role).toBe('Founder');
    expect(result.current.values.bio).toBe('I ship.');
    expect(result.current.values['tone:discord']).toBe('Lowercase, no emoji.');
    expect(result.current.values['tone:generic']).toBe('');
  });
});
