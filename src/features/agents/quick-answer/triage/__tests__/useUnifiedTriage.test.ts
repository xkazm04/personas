/**
 * `decide` — the deck's optimistic resolve and what undoes it.
 *
 * This hook resolves a card the MOMENT the reviewer decides, before the write
 * has landed, because a triage surface that pauses after every card is a triage
 * surface nobody finishes. The only thing that makes that honest is what happens
 * when the write does not land, and that branch had no test at all: a
 * regression here does not throw, it silently reports decisions that never
 * reached SQLite.
 *
 * Three outcomes, three different correct behaviours:
 *  • deferral        — write nothing, KEEP the card (it was never decided);
 *  • failed write    — RESTORE the card (it is still undecided);
 *  • lost swap (CAS) — KEEP it resolved and re-read (it IS decided, by someone
 *                      else) — putting it back would re-offer a decision that
 *                      can never land.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

import type { DevIdea } from '@/lib/bindings/DevIdea';
import type { EvolutionPromotionProposal } from '@/lib/bindings/EvolutionPromotionProposal';
import type { WorkspaceKnowledge } from '@/lib/bindings/WorkspaceKnowledge';

// --- mocks (must precede the import under test) ----------------------------

const mockTriageIdeas = vi.fn();
const mockCreateTask = vi.fn();
const mockAcceptIdea = vi.fn();
const mockRejectIdea = vi.fn();
const mockDecidePractice = vi.fn();
const mockDecidePolicy = vi.fn();
const mockDecideEvolution = vi.fn();
const mockPolicyList = vi.fn();
const mockPromotionList = vi.fn();
const mockRefreshKnowledge = vi.fn();
const mockAddToast = vi.fn();
const mockToastCatch = vi.fn();

const interactions = {
  questionGroups: [] as unknown[],
  reviews: [] as unknown[],
  questionCount: 0,
  reviewCount: 0,
  total: 0,
  loading: false,
  isProcessing: false,
  submitQuestionAnswers: vi.fn(),
  handleReviewAction: vi.fn(),
  handleDispatchAction: vi.fn(),
};

vi.mock('../../usePendingInteractions', () => ({
  usePendingInteractions: () => interactions,
}));

vi.mock('@/api/devTools/devTools', () => ({
  triageIdeas: (...args: unknown[]) => mockTriageIdeas(...args),
  createTask: (...args: unknown[]) => mockCreateTask(...args),
}));

vi.mock('@/api/system/policyTuning', () => ({
  policyTuningList: (...args: unknown[]) => mockPolicyList(...args),
}));

vi.mock('@/api/agents/evolution', () => ({
  listPromotionProposals: (...args: unknown[]) => mockPromotionList(...args),
}));

vi.mock('@/lib/decisions/rowWrites', async (importOriginal) => {
  // `isDecisionConflict` stays REAL — the whole point of the conflict test is
  // that the hook recognises the backend's actual wording.
  const actual = await importOriginal<typeof import('@/lib/decisions/rowWrites')>();
  return {
    isDecisionConflict: actual.isDecisionConflict,
    decidePracticeRow: (...args: unknown[]) => mockDecidePractice(...args),
    decidePolicyProposalRow: (...args: unknown[]) => mockDecidePolicy(...args),
    decideEvolutionProposalRow: (...args: unknown[]) => mockDecideEvolution(...args),
  };
});

const workspaceCenter = {
  workspaces: [] as { id: string; name: string; projectIds: string[] }[],
  activeId: null,
  projects: [],
  knowledge: {} as Record<string, WorkspaceKnowledge[]>,
  stats: {},
  projectById: new Map(),
  refreshKnowledge: mockRefreshKnowledge,
};

vi.mock('@/features/plugins/dev-tools/sub_workspaces/centerShared', () => ({
  useWorkspaceCenter: () => workspaceCenter,
}));

const systemState = {
  projects: [{ id: 'proj-1', name: 'Personas' }],
  acceptIdea: (...args: unknown[]) => mockAcceptIdea(...args),
  rejectIdea: (...args: unknown[]) => mockRejectIdea(...args),
};

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (sel: (s: typeof systemState) => unknown) => sel(systemState),
}));

const agentState = { personas: [{ id: 'persona-1', name: 'Scribe', color: '#abcdef' }] };

vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (sel: (s: typeof agentState) => unknown) => sel(agentState),
}));

vi.mock('@/stores/toastStore', () => ({
  useToastStore: { getState: () => ({ addToast: mockAddToast }) },
}));

vi.mock('@/lib/silentCatch', async (importOriginal) => {
  // Only `toastCatch` is stubbed. `extractMessage` stays real — the conflict
  // detector reads the backend's message through it, so stubbing it would test
  // the mock rather than the wording contract.
  const actual = await importOriginal<typeof import('@/lib/silentCatch')>();
  return {
    ...actual,
    toastCatch: (ctx: string) => (err: unknown) => mockToastCatch(ctx, err),
  };
});

vi.mock('@/i18n/useTranslation', () => ({
  getActiveTranslations: () => ({
    error_registry: { decision_conflict_message: 'Someone else already decided this — reloading.' },
  }),
}));

import { useUnifiedTriage } from '../useUnifiedTriage';

// --- fixtures --------------------------------------------------------------

function idea(overrides: Partial<DevIdea> = {}): DevIdea {
  return {
    id: 'idea-1',
    project_id: 'proj-1',
    scan_id: null,
    title: 'Cache the fleet roster',
    description: 'It is re-read on every render.',
    reasoning: null,
    category: 'technical',
    scan_type: 'performance',
    origin: null,
    effort: 3,
    impact: 8,
    risk: 2,
    priority: null,
    status: 'pending',
    evidence: null,
    verify_state: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...(overrides as object),
  } as DevIdea;
}

function practice(overrides: Partial<WorkspaceKnowledge> = {}): WorkspaceKnowledge {
  return {
    id: 'k-1',
    workspace_id: 'ws-1',
    kind: 'pattern',
    title: 'Use design tokens',
    statement: 'Raw Tailwind colours drift.',
    detail_md: null,
    topic: 'ui/tokens',
    abstraction: null,
    ftype: null,
    durability: null,
    governing_id: null,
    evidence_count: null,
    applicability: null,
    status: 'observed',
    origin_project_id: null,
    provenance: null,
    confidence: 0.8,
    dedup_key: null,
    superseded_by: null,
    valid_from: null,
    valid_to: null,
    decided_at: null,
    harvest_scope: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...(overrides as object),
  } as WorkspaceKnowledge;
}

function promotion(
  overrides: Partial<EvolutionPromotionProposal> = {},
): EvolutionPromotionProposal {
  return {
    id: 'prop-1',
    cycleId: 'cyc-1',
    personaId: 'persona-1',
    status: 'pending',
    winnerGenomeJson: '{}',
    newPrompt: 'You are a careful summariser.',
    incumbentScore: 0.7,
    winnerScore: 0.8,
    improvement: 0.1,
    threshold: 0.05,
    fitnessSource: 'measured',
    evidenceJson: null,
    baseUpdatedAt: '2026-01-20T00:00:00.000Z',
    decisionNote: null,
    createdAt: '2026-01-02T00:00:00.000Z',
    decidedAt: null,
    ...overrides,
  };
}

function page(ideas: DevIdea[]) {
  return {
    ideas,
    cursor: null,
    hasMore: false,
    counts: { pending: ideas.length, accepted: 0, rejected: 0, archived: 0, total: ideas.length },
  };
}

/** Mount and wait for the idea fetch to land. */
async function mount() {
  const hook = renderHook(() => useUnifiedTriage());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

const itemOfKind = (
  result: { current: ReturnType<typeof useUnifiedTriage> },
  kind: string,
) => {
  const found = result.current.items.find((i) => i.kind === kind);
  if (!found) throw new Error(`no ${kind} card in the queue`);
  return found;
};

beforeEach(() => {
  vi.clearAllMocks();
  workspaceCenter.workspaces = [];
  workspaceCenter.knowledge = {};
  mockTriageIdeas.mockResolvedValue(page([idea()]));
  mockAcceptIdea.mockResolvedValue(undefined);
  mockRejectIdea.mockResolvedValue(undefined);
  mockDecidePractice.mockResolvedValue(undefined);
  mockDecidePolicy.mockResolvedValue(undefined);
  mockDecideEvolution.mockResolvedValue(undefined);
  // Both proposal ledgers are empty unless a test fills them: they are opt-in
  // sources, and the queue must behave identically for an install that has
  // never run a tuning pass or an evolution cycle.
  mockPolicyList.mockResolvedValue([]);
  mockPromotionList.mockResolvedValue([]);
});

// --- tests -----------------------------------------------------------------

describe('useUnifiedTriage — decide() resolves optimistically', () => {
  it('removes the card and counts it the moment a write is issued', async () => {
    const { result } = await mount();
    const card = itemOfKind(result, 'idea');

    await act(async () => {
      await result.current.decide({ item: card, verdict: 'accept' });
    });

    expect(result.current.items).toHaveLength(0);
    expect(result.current.decidedCount).toBe(1);
    // Through the STORE, carrying the status the card showed — not the raw API.
    expect(mockAcceptIdea).toHaveBeenCalledWith('idea-1', 'pending');
  });

  it('writes an idea rejection reason and still resolves', async () => {
    const { result } = await mount();
    const card = itemOfKind(result, 'idea');

    await act(async () => {
      await result.current.decide({ item: card, verdict: 'reject', reason: 'Out of scope' });
    });

    expect(mockRejectIdea).toHaveBeenCalledWith('idea-1', 'Out of scope', 'pending');
    expect(result.current.items).toHaveLength(0);
  });
});

describe('useUnifiedTriage — a REJECTED write restores the card', () => {
  it('puts the row back, keeps it undecided, and says so', async () => {
    mockAcceptIdea.mockRejectedValueOnce(new Error('database is locked'));
    const { result } = await mount();
    const card = itemOfKind(result, 'idea');

    await act(async () => {
      await result.current.decide({ item: card, verdict: 'accept' });
    });

    // The whole contract: a failed write must not look like a completed one.
    expect(result.current.items.map((i) => i.id)).toEqual([card.id]);
    expect(result.current.decidedCount).toBe(0);
    expect(mockToastCatch).toHaveBeenCalledTimes(1);
    // Not a conflict — no "someone else decided" toast, no re-read.
    expect(mockAddToast).not.toHaveBeenCalled();
  });

  it('restores a practice card when the governance write fails', async () => {
    workspaceCenter.workspaces = [{ id: 'ws-1', name: 'Core', projectIds: [] }];
    workspaceCenter.knowledge = { 'ws-1': [practice()] };
    mockTriageIdeas.mockResolvedValue(page([]));
    mockDecidePractice.mockRejectedValueOnce(new Error('db is locked'));

    const { result } = await mount();
    const card = itemOfKind(result, 'practice');

    await act(async () => {
      await result.current.decide({ item: card, verdict: 'accept' });
    });

    expect(mockDecidePractice).toHaveBeenCalledWith('k-1', 'adopt', {
      supersededBy: undefined,
      seenStatus: 'observed',
    });
    expect(result.current.items.map((i) => i.id)).toEqual([card.id]);
    expect(result.current.decidedCount).toBe(0);
  });

  it('does not restore on the SECOND failure of a card already restored once', async () => {
    // Guards the set-based restore: `resolved` is a Set keyed by item id, so a
    // retry must not leave a stale entry that hides the card forever.
    mockAcceptIdea.mockRejectedValue(new Error('still locked'));
    const { result } = await mount();
    const card = itemOfKind(result, 'idea');

    await act(async () => {
      await result.current.decide({ item: card, verdict: 'accept' });
    });
    await act(async () => {
      await result.current.decide({ item: card, verdict: 'accept' });
    });

    expect(result.current.items.map((i) => i.id)).toEqual([card.id]);
    expect(result.current.decidedCount).toBe(0);
    expect(mockAcceptIdea).toHaveBeenCalledTimes(2);
  });
});

describe('useUnifiedTriage — a LOST compare-and-swap is not a failed write', () => {
  it('keeps the card resolved, names the conflict, and re-reads the sources', async () => {
    mockAcceptIdea.mockRejectedValueOnce(
      new Error("Backlog idea idea-1 was already decided as 'rejected' by a concurrent action"),
    );
    const { result } = await mount();
    const card = itemOfKind(result, 'idea');
    expect(mockTriageIdeas).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.decide({ item: card, verdict: 'accept' });
    });

    // Restoring would re-offer a decision that can never land — the row IS
    // decided, just not by this reviewer (Athena's Night Shift resolves
    // approvals unattended, so this is routine rather than exotic).
    expect(result.current.items).toHaveLength(0);
    expect(mockAddToast).toHaveBeenCalledWith(
      'Someone else already decided this — reloading.',
      'warning',
      expect.any(Number),
    );
    // The generic "could not record that decision" toast must NOT also fire.
    expect(mockToastCatch).not.toHaveBeenCalled();
    // And the sources are re-read so the rest of the queue reflects the winner.
    await waitFor(() => expect(mockTriageIdeas).toHaveBeenCalledTimes(2));
    expect(mockRefreshKnowledge).toHaveBeenCalled();
  });

  it('keeps the session progress rather than resetting the deck', async () => {
    // A conflict on a card the reviewer never touched must not throw away the
    // decisions they HAVE made — that is what `reload()` would do.
    mockTriageIdeas.mockResolvedValue(page([idea(), idea({ id: 'idea-2' })]));
    const { result } = await mount();

    await act(async () => {
      await result.current.decide({ item: itemOfKind(result, 'idea'), verdict: 'accept' });
    });
    expect(result.current.decidedCount).toBe(1);

    mockAcceptIdea.mockRejectedValueOnce(
      new Error('Backlog idea idea-2 was already resolved by a concurrent action'),
    );
    await act(async () => {
      await result.current.decide({ item: itemOfKind(result, 'idea'), verdict: 'accept' });
    });

    expect(result.current.decidedCount).toBe(2);
  });
});

describe('useUnifiedTriage — the two proposal queues reach the same spine', () => {
  it('deals a promotion card, names its persona, and writes through the one door', async () => {
    mockTriageIdeas.mockResolvedValue(page([]));
    mockPromotionList.mockResolvedValue([promotion()]);

    const { result } = await mount();
    const card = itemOfKind(result, 'evolution');
    expect(card.title).toContain('Scribe');

    await act(async () => {
      await result.current.decide({ item: card, verdict: 'reject', reason: 'Gain too small' });
    });

    expect(mockDecideEvolution).toHaveBeenCalledWith('prop-1', 'reject', {
      reason: 'Gain too small',
      seenStatus: 'pending',
    });
    expect(result.current.items).toHaveLength(0);
    expect(result.current.decidedCount).toBe(1);
  });

  it('treats the PERSONA optimistic lock as a lost swap, not a failed write', async () => {
    // The promotion's second lock lives on a different table, and this is the
    // whole reason `isDecisionConflict` had to learn its wording: restoring the
    // card would re-offer a decision that can never land until a fresh cycle.
    mockTriageIdeas.mockResolvedValue(page([]));
    mockPromotionList.mockResolvedValue([promotion()]);
    mockDecideEvolution.mockRejectedValueOnce(
      new Error(
        'Persona changed after this proposal was filed — promotion abandoned to avoid overwriting the newer state. Reject the proposal and run a fresh cycle.',
      ),
    );

    const { result } = await mount();
    const card = itemOfKind(result, 'evolution');

    await act(async () => {
      await result.current.decide({ item: card, verdict: 'accept' });
    });

    expect(result.current.items).toHaveLength(0);
    expect(mockAddToast).toHaveBeenCalledWith(
      'Someone else already decided this — reloading.',
      'warning',
      expect.any(Number),
    );
    expect(mockToastCatch).not.toHaveBeenCalled();
    await waitFor(() => expect(mockPromotionList).toHaveBeenCalledTimes(2));
  });

  it('keeps the deck usable when a proposal ledger is unavailable', async () => {
    // The two ledgers are fetched independently on purpose: an install where
    // one subsystem errors must not lose the other's queue — or the ideas.
    mockPolicyList.mockRejectedValue(new Error('command not found'));
    const { result } = await mount();
    expect(result.current.items.map((i) => i.kind)).toEqual(['idea']);
  });
});

describe('useUnifiedTriage — deferrals write nothing and keep the card', () => {
  it('skips without touching any backend', async () => {
    const { result } = await mount();
    const card = itemOfKind(result, 'idea');

    await act(async () => {
      await result.current.decide({ item: card, verdict: 'skip' });
    });

    expect(mockAcceptIdea).not.toHaveBeenCalled();
    expect(mockRejectIdea).not.toHaveBeenCalled();
    expect(result.current.decidedCount).toBe(0);
    // Skip sorts last, it does not hide — the card is still offered.
    expect(result.current.items.map((i) => i.id)).toEqual([card.id]);
    expect(result.current.skips.get(card.id)).toBe(1);
  });

  it('does not count a proposal deferral as a decision either', async () => {
    mockTriageIdeas.mockResolvedValue(page([]));
    mockPromotionList.mockResolvedValue([promotion()]);
    const { result } = await mount();
    const card = itemOfKind(result, 'evolution');

    await act(async () => {
      await result.current.decide({ item: card, verdict: 'skip' });
    });

    expect(mockDecideEvolution).not.toHaveBeenCalled();
    expect(result.current.decidedCount).toBe(0);
  });

  it('counts a card as deferred once it has exhausted its skip passes', async () => {
    const { result } = await mount();
    const card = itemOfKind(result, 'idea');

    // Skip until the queue stops offering it.
    for (let i = 0; i < 5 && result.current.items.length > 0; i += 1) {
      await act(async () => {
        await result.current.decide({ item: card, verdict: 'skip' });
      });
    }

    expect(result.current.items).toHaveLength(0);
    expect(result.current.deferredCount).toBe(1);
    // Still never written, and never counted as decided.
    expect(result.current.decidedCount).toBe(0);
    expect(mockAcceptIdea).not.toHaveBeenCalled();
  });
});
