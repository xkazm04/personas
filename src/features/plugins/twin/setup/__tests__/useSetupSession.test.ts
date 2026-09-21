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
    answerMode: 'pick',
    incoming: null,
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
    const { result } = renderHook(() => useSetupSession());
    await waitFor(() => expect(result.current.question).not.toBeNull());

    await act(async () => {
      await result.current.edit({
        field: 'tone',
        channel: 'generic',
        part: 'examples',
        value: '["ship it","on it"]',
      });
    });

    // The row is upserted whole, so the three parts the user did not touch have
    // to travel with the one they did. Writing null for them (what this did
    // until the typed surface exposed them) emptied the columns silently.
    expect(mockUpsertTwinTone).toHaveBeenCalledWith(
      't1',
      'generic',
      'lowercase, no emoji',
      '["ship it","on it"]',
      '["never apologise twice"]',
      '1-2 sentences',
    );
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
// The readiness strip has to DRIVE the content
// ---------------------------------------------------------------------------

describe('useSetupSession — focusOn asks the new slot a question', () => {
  it('requests a turn on the slot it was given, and drops the previous cards', async () => {
    const { result } = renderHook(() => useSetupSession());
    await waitFor(() => expect(result.current.question).not.toBeNull());
    expect(result.current.suggestions.length).toBe(1);

    // The second call is held open so the state BETWEEN the click and the
    // reply is observable: that window is where the old suggestions used to
    // sit under the new slot's heading.
    let release!: (value: SetupTurnResult) => void;
    mockSetupTurn.mockClear();
    mockSetupTurn.mockReturnValue(
      new Promise<SetupTurnResult>((resolve) => {
        release = resolve;
      }),
    );

    act(() => {
      result.current.focusOn('tone');
    });

    expect(result.current.focus).toBe('tone');
    expect(mockSetupTurn).toHaveBeenCalledTimes(1);
    // The focus argument is the NEW slot. Reading it out of state would have
    // sent 'identity' here, which is the defect this test exists for.
    expect(mockSetupTurn.mock.calls[0]?.[3]).toBe('tone');
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.proposals).toEqual([]);

    await act(async () => {
      release(turn({ focus: 'tone', question: 'How do you sound at work?' }));
    });
    await waitFor(() => expect(result.current.question).toBe('How do you sound at work?'));
    // The transcript keeps both turns: the trail is how the switch stays legible.
    expect(result.current.history.length).toBeGreaterThanOrEqual(2);
  });

  it('ignores a click on the slot already in focus while its turn is in flight', async () => {
    let release!: (value: SetupTurnResult) => void;
    mockSetupTurn.mockReturnValue(
      new Promise<SetupTurnResult>((resolve) => {
        release = resolve;
      }),
    );
    const { result } = renderHook(() => useSetupSession());
    await waitFor(() => expect(result.current.busy).toBe(true));
    expect(mockSetupTurn).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.focusOn('identity');
    });
    expect(mockSetupTurn).toHaveBeenCalledTimes(1);

    await act(async () => {
      release(turn());
    });
    await waitFor(() => expect(result.current.busy).toBe(false));

    // And once a question is on screen, clicking its own slot still leaves it
    // alone rather than re-rolling the question the user is reading.
    act(() => {
      result.current.focusOn('identity');
    });
    expect(mockSetupTurn).toHaveBeenCalledTimes(1);
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

// ---------------------------------------------------------------------------
// Writing samples are the person's own words
// ---------------------------------------------------------------------------

describe("useSetupSession — a writing sample is the person's own words", () => {
  const writeTurn = () =>
    turn({
      question: 'Your manager on Slack sends this. Reply the way you would.',
      focus: 'tone',
      toneChannel: 'slack',
      answerMode: 'write',
      incoming: 'can we push the review to thursday?',
      suggestions: [],
    });

  it('a write turn deals no cards and says what is being replied to', async () => {
    mockSetupTurn.mockResolvedValue({
      ...writeTurn(),
      // A model that ignored the contract. The hand stays empty regardless.
      suggestions: [{ text: 'Sure thing! Thursday works great.', reason: 'x' }],
    });
    const { result } = renderHook(() => useSetupSession());
    await waitFor(() => expect(result.current.question).not.toBeNull());

    expect(result.current.answerMode).toBe('write');
    expect(result.current.incoming).toBe('can we push the review to thursday?');
    expect(result.current.toneChannel).toBe('slack');
    expect(result.current.suggestions).toEqual([]);
  });

  it('the answer is offered back verbatim as a sample, and nothing is written until it is accepted', async () => {
    setStore({
      twinTones: [
        makeTone({
          channel: 'slack',
          voice_directives: 'lowercase',
          examples_json: '["on it"]',
          constraints_json: '["never apologise twice"]',
          length_hint: 'one line',
        }),
      ],
    });
    mockSetupTurn.mockResolvedValueOnce(writeTurn());
    mockSetupTurn.mockResolvedValue(turn({ question: 'And on email?' }));
    const { result } = renderHook(() => useSetupSession());
    await waitFor(() => expect(result.current.answerMode).toBe('write'));

    await act(async () => {
      await result.current.answer('  yep thursday works, same time?  ');
    });

    expect(mockUpsertTwinTone).not.toHaveBeenCalled();
    const sample = result.current.proposals.find((p) => p.part === 'examples');
    expect(sample).toMatchObject({
      kind: 'tone',
      part: 'examples',
      channel: 'slack',
      value: 'yep thursday works, same time?',
    });
    // It rides on the next guide turn, so its verdict lands in the trail.
    expect(result.current.history.at(-1)?.proposals?.some((p) => p.id === sample!.id)).toBe(true);

    await act(async () => {
      await result.current.accept(sample!);
    });
    // Appended to the samples; the voice, the rules and the length travel over.
    expect(mockUpsertTwinTone).toHaveBeenCalledWith(
      't1',
      'slack',
      'lowercase',
      '["on it","yep thursday works, same time?"]',
      '["never apologise twice"]',
      'one line',
    );
  });

  it('a pick answer and a training answer are never offered as samples', async () => {
    const { result } = renderHook(() => useSetupSession());
    await waitFor(() => expect(result.current.question).not.toBeNull());
    await act(async () => {
      await result.current.answer('Shipping things');
    });
    expect(result.current.proposals).toEqual([]);

    mockSetupTurn.mockResolvedValue(writeTurn());
    act(() => {
      result.current.focusOn('tone');
    });
    await waitFor(() => expect(result.current.answerMode).toBe('write'));
    act(() => {
      result.current.setStage('training');
    });
    mockSetupTurn.mockResolvedValue(turn({ question: 'Next?' }));
    await act(async () => {
      await result.current.answer('yep thursday works');
    });
    // Kept word for word as training material instead.
    expect(mockRecordInteraction).toHaveBeenCalled();
    expect(result.current.proposals).toEqual([]);
  });

  it('an accepted rule is appended to the constraints and carries the rest of the row', async () => {
    setStore({
      twinTones: [makeTone({ channel: 'email', voice_directives: 'Short.', constraints_json: '["Always sign off with M"]' })],
    });
    mockSetupTurn.mockResolvedValue(
      turn({
        focus: 'channels',
        proposals: [
          {
            id: 'r1',
            kind: 'tone',
            part: 'constraints',
            channel: 'email',
            value: 'Never agree to a meeting time without checking with me.',
            lengthHint: null,
            reason: 'They said so.',
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
      'email',
      'Short.',
      null,
      '["Always sign off with M","Never agree to a meeting time without checking with me."]',
      null,
    );
  });

  it('a register with a tone row and no bound channel is still covered', async () => {
    setStore({ twinTones: [makeTone({ channel: 'email' })] });
    const { result } = renderHook(() => useSetupSession());
    await waitFor(() => expect(result.current.question).not.toBeNull());
    expect(result.current.toneChannels).toEqual(['generic', 'email']);
  });

  it('asks the guide to speak the app language', async () => {
    renderHook(() => useSetupSession());
    await waitFor(() => expect(mockSetupTurn).toHaveBeenCalled());
    expect(typeof mockSetupTurn.mock.calls[0]?.[6]).toBe('string');
  });
});

describe('useSetupSession — redeal asks again without recording anything', () => {
  it('replaces the live question on the same slot and writes nothing', async () => {
    const { result } = renderHook(() => useSetupSession());
    await waitFor(() => expect(result.current.question).toBe('What are you known for?'));
    mockSetupTurn.mockClear();
    mockSetupTurn.mockResolvedValue(turn({ question: 'Where did you start out?' }));

    act(() => {
      result.current.redeal();
    });

    await waitFor(() => expect(result.current.question).toBe('Where did you start out?'));
    expect(mockSetupTurn).toHaveBeenCalledTimes(1);
    expect(mockRecordInteraction).not.toHaveBeenCalled();
    expect(mockUpdateTwinProfile).not.toHaveBeenCalled();
  });

  it('is ignored while a turn is in flight', async () => {
    let release!: (value: SetupTurnResult) => void;
    mockSetupTurn.mockReturnValue(
      new Promise<SetupTurnResult>((resolve) => {
        release = resolve;
      }),
    );
    const { result } = renderHook(() => useSetupSession());
    await waitFor(() => expect(result.current.busy).toBe(true));
    act(() => {
      result.current.redeal();
    });
    expect(mockSetupTurn).toHaveBeenCalledTimes(1);
    await act(async () => {
      release(turn());
    });
  });
});
