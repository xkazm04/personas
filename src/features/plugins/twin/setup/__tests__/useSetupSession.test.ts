import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { TwinProfile } from '@/lib/bindings/TwinProfile';
import type { TwinTone } from '@/lib/bindings/TwinTone';
import type { TwinChannel } from '@/lib/bindings/TwinChannel';
import type { TwinPendingMemory } from '@/lib/bindings/TwinPendingMemory';
import type { SetupTurnResult } from '@/lib/bindings/SetupTurnResult';

// ---------------------------------------------------------------------------
// Mocks — before the module under test is imported.
// ---------------------------------------------------------------------------

const mockSetupTurn = vi.fn();
const mockRecordInteraction = vi.fn().mockResolvedValue({});
vi.mock('@/api/twin/twin', () => ({
  setupTurn: (...args: unknown[]) => mockSetupTurn(...args),
}));

const mockUpdateTwinProfile = vi.fn().mockResolvedValue(undefined);
const mockUpsertTwinTone = vi.fn().mockResolvedValue({});
const mockSetPendingTrainingQuestions = vi.fn();

let storeState: Record<string, unknown> = {};
vi.mock('@/stores/systemStore', () => {
  const useSystemStore = <T,>(selector: (s: Record<string, unknown>) => T): T =>
    selector(storeState);
  (useSystemStore as unknown as { getState: () => unknown }).getState = () => storeState;
  return { useSystemStore };
});

vi.mock('@/lib/silentCatch', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/silentCatch');
  return { ...actual, toastCatch: () => () => {}, silentCatch: () => () => {} };
});

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

function turn(over: Partial<SetupTurnResult> = {}): SetupTurnResult {
  return {
    question: 'What are you known for?',
    focus: 'identity',
    toneChannel: null,
    suggestions: [{ text: 'Shipping things', reason: 'Matches the bio.' }],
    proposals: [],
    doneHint: false,
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
    recordTwinInteraction: mockRecordInteraction,
    pendingTrainingQuestions: null,
    setPendingTrainingQuestions: mockSetPendingTrainingQuestions,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSetupTurn.mockResolvedValue(turn());
  mockRecordInteraction.mockResolvedValue({});
  mockUpdateTwinProfile.mockResolvedValue(undefined);
  mockUpsertTwinTone.mockResolvedValue({});
  setStore();
});

// ---------------------------------------------------------------------------
// The completion authority
// ---------------------------------------------------------------------------

describe('useSetupSession — readiness is the completion authority', () => {
  it('derives the checklist from stored rows, not from doneHint', async () => {
    // The generator insists everything is finished. Nothing is stored.
    mockSetupTurn.mockResolvedValue(turn({ doneHint: true }));
    const { result } = renderHook(() => useSetupSession());
    await waitFor(() => expect(result.current.question).not.toBeNull());

    expect(result.current.checklist.map((c) => c.status)).toEqual([
      'empty',
      'empty',
      'empty',
      'empty',
    ]);
    expect(result.current.score).toBe(0);
    // And the focus still points at the first unfinished slot.
    expect(result.current.focus).toBe('identity');
  });

  it('moves the checklist when the STORE changes, with doneHint false throughout', async () => {
    mockSetupTurn.mockResolvedValue(turn({ doneHint: false }));
    setStore({
      twinProfiles: [
        makeProfile({
          bio: 'I build local-first developer tools and I write about the parts that go wrong.',
        }),
      ],
      twinTones: [makeTone(), makeTone({ id: 'tn2', channel: 'discord' })],
      twinChannels: [makeChannel()],
      twinReadinessApproved: Array.from({ length: 5 }, (_, i) =>
        makeMemory({ id: `m${i}` }),
      ),
    });
    const { result } = renderHook(() => useSetupSession());
    await waitFor(() => expect(result.current.question).not.toBeNull());

    expect(result.current.checklist.map((c) => c.status)).toEqual([
      'set',
      'set',
      'set',
      'set',
    ]);
    // 80, not 100: `deriveReadiness` scores FIVE milestones and the fifth —
    // `brain` (a bound knowledge base) — is not one of Setup's four slots; it
    // lives in the Hub. The checklist and the score answer different questions
    // and the session reports both unmodified.
    expect(result.current.score).toBe(80);
  });

  it("exposes 'generic' plus every bound channel type as the tone slots", async () => {
    setStore({
      twinChannels: [
        makeChannel({ channel_type: 'discord' }),
        makeChannel({ id: 'c2', channel_type: 'email' }),
        makeChannel({ id: 'c3', channel_type: 'discord' }),
      ],
    });
    const { result } = renderHook(() => useSetupSession());
    await waitFor(() => expect(result.current.question).not.toBeNull());
    expect(result.current.toneChannels).toEqual(['generic', 'discord', 'email']);
  });

  it('opens the typed fields on what is stored', async () => {
    setStore({
      twinProfiles: [makeProfile({ role: 'Founder', bio: 'I ship.' })],
      twinTones: [makeTone({ channel: 'discord', voice_directives: 'Lowercase, no emoji.' })],
      twinChannels: [makeChannel({ channel_type: 'discord' })],
    });
    const { result } = renderHook(() => useSetupSession());
    await waitFor(() => expect(result.current.question).not.toBeNull());

    expect(result.current.values.role).toBe('Founder');
    expect(result.current.values.bio).toBe('I ship.');
    expect(result.current.values['tone:discord']).toBe('Lowercase, no emoji.');
    // A tone slot with no row yet opens empty rather than undefined.
    expect(result.current.values['tone:generic']).toBe('');
  });
});

// ---------------------------------------------------------------------------
// A generator failure must not read as completion
// ---------------------------------------------------------------------------

describe('useSetupSession — a failing generator leaves the slot open', () => {
  it('sets generatorError, keeps the checklist untouched and still allows a typed edit', async () => {
    mockSetupTurn.mockRejectedValue(new Error('Claude CLI returned non-zero exit code'));
    const { result } = renderHook(() => useSetupSession());

    await waitFor(() => expect(result.current.generatorError).not.toBeNull());
    expect(result.current.question).toBeNull();
    expect(result.current.checklist.every((c) => c.status === 'empty')).toBe(true);
    expect(result.current.score).toBe(0);
    expect(result.current.focus).toBe('identity');

    // The typed path is untouched by the generator being down — this is the
    // whole reason `edit` shares no code with `answer`.
    await act(async () => {
      await result.current.edit({ field: 'bio', value: 'I build local-first tools.' });
    });
    expect(mockUpdateTwinProfile).toHaveBeenCalledWith('t1', {
      bio: 'I build local-first tools.',
    });
  });

  it('clears generatorError on the next successful turn', async () => {
    mockSetupTurn.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useSetupSession());
    await waitFor(() => expect(result.current.generatorError).not.toBeNull());

    mockSetupTurn.mockResolvedValue(turn({ question: 'Second question?' }));
    await act(async () => {
      await result.current.answer('an answer');
    });
    await waitFor(() => expect(result.current.generatorError).toBeNull());
    expect(result.current.question).toBe('Second question?');
  });
});

// ---------------------------------------------------------------------------
// accept / skip
// ---------------------------------------------------------------------------

describe('useSetupSession — accept writes, skip does not', () => {
  it('accept() routes a bio proposal to updateTwinProfile and records the verdict', async () => {
    mockSetupTurn.mockResolvedValue(
      turn({
        proposals: [
          {
            id: 'p1',
            kind: 'bio',
            channel: null,
            value: 'I build local-first developer tools.',
            lengthHint: null,
            reason: 'Their own words.',
          },
        ],
      }),
    );
    const { result } = renderHook(() => useSetupSession());
    await waitFor(() => expect(result.current.proposals.length).toBe(1));

    const proposal = result.current.proposals[0]!;
    await act(async () => {
      await result.current.accept(proposal);
    });

    expect(mockUpdateTwinProfile).toHaveBeenCalledWith('t1', {
      bio: 'I build local-first developer tools.',
    });
    expect(mockUpsertTwinTone).not.toHaveBeenCalled();
    const guideEntry = result.current.history.find((h) => h.proposals);
    expect(guideEntry?.resolutions?.p1).toBe('accepted');
  });

  it('accept() routes a tone proposal to upsertTwinTone on its own channel', async () => {
    setStore({ twinChannels: [makeChannel({ channel_type: 'discord' })] });
    mockSetupTurn.mockResolvedValue(
      turn({
        focus: 'tone',
        toneChannel: 'discord',
        proposals: [
          {
            id: 'p2',
            kind: 'tone',
            channel: 'discord',
            value: 'lowercase, no emoji, one line',
            lengthHint: '1-2 sentences',
            reason: 'How they wrote in the answer above.',
          },
        ],
      }),
    );
    const { result } = renderHook(() => useSetupSession());
    await waitFor(() => expect(result.current.proposals.length).toBe(1));

    await act(async () => {
      await result.current.accept(result.current.proposals[0]!);
    });

    expect(mockUpsertTwinTone).toHaveBeenCalledWith(
      't1',
      'discord',
      'lowercase, no emoji, one line',
      null,
      null,
      '1-2 sentences',
    );
    expect(mockUpdateTwinProfile).not.toHaveBeenCalled();
  });

  it('a proposal is never auto-applied — arriving writes nothing', async () => {
    mockSetupTurn.mockResolvedValue(
      turn({
        proposals: [
          {
            id: 'p3',
            kind: 'role',
            channel: null,
            value: 'Founder',
            lengthHint: null,
            reason: 'They said so.',
          },
        ],
      }),
    );
    const { result } = renderHook(() => useSetupSession());
    await waitFor(() => expect(result.current.proposals.length).toBe(1));
    expect(mockUpdateTwinProfile).not.toHaveBeenCalled();
    expect(mockUpsertTwinTone).not.toHaveBeenCalled();
  });

  it('skip() stores no value and asks the next question instead', async () => {
    const { result } = renderHook(() => useSetupSession());
    await waitFor(() => expect(result.current.question).not.toBeNull());
    mockSetupTurn.mockClear();
    mockSetupTurn.mockResolvedValue(turn({ question: 'Something else, then?' }));

    await act(async () => {
      await result.current.skip();
    });

    expect(mockUpdateTwinProfile).not.toHaveBeenCalled();
    expect(mockUpsertTwinTone).not.toHaveBeenCalled();
    expect(mockRecordInteraction).not.toHaveBeenCalled();
    expect(mockSetupTurn).toHaveBeenCalledTimes(1);
    expect(result.current.question).toBe('Something else, then?');
  });

  it('a training answer is recorded as a memory carrying both question and answer', async () => {
    const { result } = renderHook(() => useSetupSession());
    await waitFor(() => expect(result.current.question).not.toBeNull());
    act(() => {
      result.current.setStage('training');
    });

    await act(async () => {
      await result.current.answer('I start from the smallest thing that unblocks someone.');
    });

    expect(mockRecordInteraction).toHaveBeenCalledWith(
      't1',
      'training',
      'out',
      'I start from the smallest thing that unblocks someone.',
      undefined,
      'Training Q&A: What are you known for?',
      JSON.stringify([
        {
          q: 'What are you known for?',
          a: 'I start from the smallest thing that unblocks someone.',
        },
      ]),
      true,
    );
  });

  it('a setup-stage answer records nothing — only training material is stored', async () => {
    const { result } = renderHook(() => useSetupSession());
    await waitFor(() => expect(result.current.question).not.toBeNull());

    await act(async () => {
      await result.current.answer('Local-first developer tools.');
    });

    expect(mockRecordInteraction).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The Hub handoff
// ---------------------------------------------------------------------------

describe('useSetupSession — dig-deeper handoff', () => {
  it('asks the handed-over questions before consulting the generator', async () => {
    setStore({ pendingTrainingQuestions: ['What went wrong in 2019?'] });
    const { result } = renderHook(() => useSetupSession());

    await waitFor(() => expect(result.current.question).toBe('What went wrong in 2019?'));
    expect(result.current.stage).toBe('training');
    expect(mockSetPendingTrainingQuestions).toHaveBeenCalledWith(null);
  });
});
