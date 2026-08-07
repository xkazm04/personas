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
import type { PendingAcceptanceGoal } from '@/lib/bindings/PendingAcceptanceGoal';
import type { WorkspaceKnowledge } from '@/lib/bindings/WorkspaceKnowledge';

// --- mocks (must precede the import under test) ----------------------------

const mockTriageIdeas = vi.fn();
const mockCreateTask = vi.fn();
const mockAcceptIdea = vi.fn();
const mockRejectIdea = vi.fn();
const mockDecidePractice = vi.fn();
const mockReopenIdea = vi.fn();
const mockReopenPractice = vi.fn();
const mockDecidePolicy = vi.fn();
const mockDecideEvolution = vi.fn();
const mockPolicyList = vi.fn();
const mockPromotionList = vi.fn();
const mockPendingAcceptance = vi.fn();
const mockAcceptGoal = vi.fn();
const mockRejectGoal = vi.fn();
const mockRefreshPendingCounts = vi.fn();
const mockRefreshKnowledge = vi.fn();
const mockAddToast = vi.fn();
const mockToastCatch = vi.fn();

const interactions = {
  questionGroups: [] as unknown[],
  reviews: [] as unknown[],
  reviewsError: null as string | null,
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
  listPendingAcceptance: (...args: unknown[]) => mockPendingAcceptance(...args),
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
    reopenIdeaRow: (...args: unknown[]) => mockReopenIdea(...args),
    reopenPracticeRow: (...args: unknown[]) => mockReopenPractice(...args),
  };
});

const workspaceCenter = {
  workspaces: [] as { id: string; name: string; projectIds: string[] }[],
  activeId: null,
  projects: [],
  knowledge: {} as Record<string, WorkspaceKnowledge[]>,
  knowledgeError: null as string | null,
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
  // Goal verdicts go through the slice too — it owns the row write AND the
  // pending-acceptance count, and both rethrow so the deck can restore.
  acceptGoal: (...args: unknown[]) => mockAcceptGoal(...args),
  rejectGoal: (...args: unknown[]) => mockRejectGoal(...args),
  // The title-bar badge counts what this deck deals, so a settled verdict has
  // to move it — otherwise the number the reviewer is clearing sits unchanged
  // until the next 30s poll.
  refreshPendingCounts: (...args: unknown[]) => mockRefreshPendingCounts(...args),
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

import { clearJournal, resetJournalCache } from '../triageJournal';
import { clearTriageSession, resetTriageSessionCache } from '../triageSession';
import { TRIAGE_KINDS } from '../triageTypes';
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

function pendingGoal(overrides: Partial<PendingAcceptanceGoal> = {}): PendingAcceptanceGoal {
  return {
    goal_id: 'goal-1',
    title: 'Merge the two onboarding flows',
    summary: 'One flow now covers both entry points.',
    project_id: 'proj-1',
    project_name: 'Personas',
    team_id: 'team-1',
    team_name: 'Growth',
    kpi_id: 'kpi-1',
    kpi_name: 'Activation rate',
    kpi_unit: '%',
    kpi_current: 34,
    kpi_target: 50,
    kpi_baseline: 20,
    kpi_direction: 'up',
    completed_at: '2026-02-02T00:00:00.000Z',
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

/** Mount and wait for every source fetch to land. */
async function mount(hosts?: Parameters<typeof useUnifiedTriage>[1]) {
  const hook = renderHook(() => useUnifiedTriage(undefined, hosts));
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
  // The session and the journal are now DURABLE — that is the feature — so
  // every test starts from a deck that has never been opened. A test that
  // wants continuity across a remount asks for it explicitly.
  clearTriageSession();
  clearJournal();
  resetTriageSessionCache();
  resetJournalCache();
  interactions.reviewsError = null;
  workspaceCenter.workspaces = [];
  workspaceCenter.knowledgeError = null;
  workspaceCenter.knowledge = {};
  mockTriageIdeas.mockResolvedValue(page([idea()]));
  mockAcceptIdea.mockResolvedValue(undefined);
  mockRejectIdea.mockResolvedValue(undefined);
  mockDecidePractice.mockResolvedValue(undefined);
  mockReopenIdea.mockResolvedValue(undefined);
  mockReopenPractice.mockResolvedValue(undefined);
  mockDecidePolicy.mockResolvedValue(undefined);
  mockDecideEvolution.mockResolvedValue(undefined);
  // Both proposal ledgers are empty unless a test fills them: they are opt-in
  // sources, and the queue must behave identically for an install that has
  // never run a tuning pass or an evolution cycle.
  mockPolicyList.mockResolvedValue([]);
  mockPromotionList.mockResolvedValue([]);
  // Same for goals: an install with nothing awaiting sign-off must deal the
  // rest of the queue exactly as it did before goals joined it.
  mockPendingAcceptance.mockResolvedValue([]);
  mockAcceptGoal.mockResolvedValue(undefined);
  mockRejectGoal.mockResolvedValue(undefined);
  mockRefreshPendingCounts.mockResolvedValue(undefined);
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

describe('useUnifiedTriage — a settled verdict moves the title-bar badge', () => {
  it('refreshes the pending counts once the write lands', async () => {
    const { result } = await mount();
    const card = itemOfKind(result, 'idea');

    await act(async () => {
      await result.current.decide({ item: card, verdict: 'accept' });
    });

    // The badge is polled on a 30s bucket. Without this nudge, clearing the
    // deck leaves the number it is meant to be clearing standing for up to
    // half a minute, which reads as a broken badge rather than a slow one.
    expect(mockRefreshPendingCounts).toHaveBeenCalled();
  });

  it('leaves the badge alone when the write is REJECTED', async () => {
    mockAcceptIdea.mockRejectedValueOnce(new Error('database is locked'));
    const { result } = await mount();
    const card = itemOfKind(result, 'idea');

    await act(async () => {
      await result.current.decide({ item: card, verdict: 'accept' });
    });

    // Nothing left any queue, so re-counting would only spend a round-trip to
    // print the same number — and a badge that ticks down on a failed write
    // would be telling the reviewer the decision landed.
    expect(mockRefreshPendingCounts).not.toHaveBeenCalled();
  });

  it('leaves the badge alone for a deferral', async () => {
    const { result } = await mount();
    const card = itemOfKind(result, 'idea');

    await act(async () => {
      await result.current.decide({ item: card, verdict: 'skip' });
    });

    // A skip writes nothing and the row is still pending — the badge is still
    // right, and re-reading it would be a round-trip to confirm no change.
    expect(mockRefreshPendingCounts).not.toHaveBeenCalled();
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

describe('useUnifiedTriage — the session survives closing the deck', () => {
  // `QuickAnswerPopover` unmounts whenever the header overlay changes, so a
  // remount is not an edge case: it is what closing the deck IS.
  it('brings deferrals and the kind filter back on the next open', async () => {
    mockTriageIdeas.mockResolvedValue(page([idea(), idea({ id: 'idea-2' })]));
    const first = await mount();

    await act(async () => {
      await first.result.current.decide({
        item: itemOfKind(first.result, 'idea'),
        verdict: 'skip',
      });
    });
    act(() => first.result.current.toggleKind('practice'));
    const skippedId = [...first.result.current.skips.keys()][0]!;
    const kinds = [...first.result.current.activeKinds].sort();
    first.unmount();

    const second = await mount();
    expect(second.result.current.skips.get(skippedId)).toBe(1);
    expect([...second.result.current.activeKinds].sort()).toEqual(kinds);
    // And the skip-pass bound came back WITH it: the SECOND skip of that card
    // stands it down for the session, rather than the wedge guard restarting
    // from zero every time the deck is reopened.
    const again = second.result.current.items.find((i) => i.id === skippedId)!;
    // It sorts last, behind everything still undecided — skip does not hide.
    expect(second.result.current.items.at(-1)?.id).toBe(skippedId);
    await act(async () => {
      await second.result.current.decide({ item: again, verdict: 'skip' });
    });
    expect(second.result.current.items.some((i) => i.id === skippedId)).toBe(false);
    expect(second.result.current.deferredCount).toBe(1);
  });

  it('keeps what the session already decided out of the queue and in the count', async () => {
    mockTriageIdeas.mockResolvedValue(page([idea(), idea({ id: 'idea-2' })]));
    const first = await mount();
    await act(async () => {
      await first.result.current.decide({
        item: itemOfKind(first.result, 'idea'),
        verdict: 'accept',
      });
    });
    first.unmount();

    const second = await mount();
    // The backend would normally stop returning it, but a poll landing before
    // the write commits must not re-offer a card this reviewer just decided.
    expect(second.result.current.items).toHaveLength(1);
    expect(second.result.current.decidedCount).toBe(1);
  });

  it('reload() ENDS the session — deferrals do not come back with it', async () => {
    const first = await mount();
    await act(async () => {
      await first.result.current.decide({
        item: itemOfKind(first.result, 'idea'),
        verdict: 'skip',
      });
    });
    act(() => first.result.current.reload());
    first.unmount();

    const second = await mount();
    expect(second.result.current.skips.size).toBe(0);
    expect(second.result.current.summary.decided).toBe(0);
  });

  it('records the session summary, and carries it across the close', async () => {
    mockTriageIdeas.mockResolvedValue(page([idea(), idea({ id: 'idea-2' })]));
    const first = await mount();
    await act(async () => {
      await first.result.current.decide({
        item: itemOfKind(first.result, 'idea'),
        verdict: 'accept',
      });
    });
    expect(first.result.current.summary.decided).toBe(1);
    expect(first.result.current.summary.accepted).toBe(1);
    expect(first.result.current.summary.byKind).toEqual([
      { kind: 'idea', decided: 1, accepted: 1 },
    ]);
    first.unmount();

    const second = await mount();
    expect(second.result.current.summary.decided).toBe(1);
  });
});

describe('useUnifiedTriage — undo', () => {
  it('offers the last verdict back, and reopens against the status it produced', async () => {
    const { result } = await mount();
    const card = itemOfKind(result, 'idea');

    await act(async () => {
      await result.current.decide({ item: card, verdict: 'accept' });
    });
    expect(result.current.undo?.type).toBe('verdict');
    expect(result.current.decidedCount).toBe(1);

    await act(async () => {
      await result.current.undoLast();
    });

    // An undo is a WRITE against an expectation — the status this reviewer's
    // own verdict was supposed to leave on the row.
    expect(mockReopenIdea).toHaveBeenCalledWith('idea-1', { seenStatus: 'accepted' });
    expect(result.current.decidedCount).toBe(0);
    expect(result.current.undo).toBeNull();
    // Amended, not erased: "decided then undone" is not "never decided".
    expect(result.current.summary.undone).toBe(1);
    expect(result.current.summary.decided).toBe(0);
  });

  it('LOSES the swap gracefully, with the same message as any other lost verdict', async () => {
    // Someone else decided the row between the verdict and the undo. Putting
    // the card back would re-offer a decision that can never land.
    mockReopenIdea.mockRejectedValueOnce(
      new Error("Backlog idea idea-1 was already decided as 'rejected' by a concurrent action"),
    );
    const { result } = await mount();
    const card = itemOfKind(result, 'idea');

    await act(async () => {
      await result.current.decide({ item: card, verdict: 'accept' });
    });
    expect(mockTriageIdeas).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.undoLast();
    });

    expect(result.current.items).toHaveLength(0);
    expect(result.current.decidedCount).toBe(1);
    expect(mockAddToast).toHaveBeenCalledWith(
      'Someone else already decided this — reloading.',
      'warning',
      expect.any(Number),
    );
    // The generic "could not" toast must NOT also fire — a lost swap is not a
    // failure to write.
    expect(mockToastCatch).not.toHaveBeenCalled();
    // And the offer is spent either way.
    expect(result.current.undo).toBeNull();
    await waitFor(() => expect(mockTriageIdeas).toHaveBeenCalledTimes(2));
  });

  it('leaves the row decided and says so when the undo simply fails', async () => {
    mockReopenIdea.mockRejectedValueOnce(new Error('database is locked'));
    const { result } = await mount();

    await act(async () => {
      await result.current.decide({ item: itemOfKind(result, 'idea'), verdict: 'accept' });
    });
    await act(async () => {
      await result.current.undoLast();
    });

    expect(result.current.decidedCount).toBe(1);
    expect(mockToastCatch).toHaveBeenCalledTimes(1);
    expect(mockAddToast).not.toHaveBeenCalled();
  });

  it('takes a SKIP back locally — no write, and available on every kind', async () => {
    mockTriageIdeas.mockResolvedValue(page([]));
    mockPromotionList.mockResolvedValue([promotion()]);
    const { result } = await mount();
    const card = itemOfKind(result, 'evolution');

    await act(async () => {
      await result.current.decide({ item: card, verdict: 'skip' });
    });
    expect(result.current.skips.get(card.id)).toBe(1);
    expect(result.current.undo?.type).toBe('skip');

    await act(async () => {
      await result.current.undoLast();
    });
    expect(result.current.skips.get(card.id)).toBeUndefined();
    expect(mockReopenIdea).not.toHaveBeenCalled();
    expect(mockDecideEvolution).not.toHaveBeenCalled();
  });

  it('offers NOTHING back for a verdict whose act is already out in the world', async () => {
    // A promotion has installed a genome on a live persona; there is no reverse
    // door, and an undo button that refuses when pressed is worse than none.
    mockTriageIdeas.mockResolvedValue(page([]));
    mockPromotionList.mockResolvedValue([promotion()]);
    const { result } = await mount();

    await act(async () => {
      await result.current.decide({ item: itemOfKind(result, 'evolution'), verdict: 'accept' });
    });
    expect(result.current.undo).toBeNull();
  });

  it('offers nothing back for a goal either — an accepted goal has no reopen', async () => {
    // `reversibleStatus` ends in `default: return null`, and goals are meant to
    // land there: no command reopens an accepted goal, and an undo button that
    // refuses when pressed is worse than no undo button.
    mockTriageIdeas.mockResolvedValue(page([]));
    mockPendingAcceptance.mockResolvedValue([pendingGoal()]);
    const { result } = await mount();

    await act(async () => {
      await result.current.decide({ item: itemOfKind(result, 'goal'), verdict: 'accept' });
    });
    expect(result.current.undo).toBeNull();
  });

  it('clears a stale offer when the next decision is not reversible', async () => {
    mockTriageIdeas.mockResolvedValue(page([idea()]));
    mockPromotionList.mockResolvedValue([promotion()]);
    const { result } = await mount();

    await act(async () => {
      await result.current.decide({ item: itemOfKind(result, 'idea'), verdict: 'accept' });
    });
    expect(result.current.undo).not.toBeNull();

    await act(async () => {
      await result.current.decide({ item: itemOfKind(result, 'evolution'), verdict: 'accept' });
    });
    // Otherwise `U` would take back the card BEFORE the one just decided.
    expect(result.current.undo).toBeNull();
  });
});

describe('useUnifiedTriage — goals reach the same spine', () => {
  it('deals a goal card, writes through the store, and re-reads the ledger', async () => {
    mockTriageIdeas.mockResolvedValue(page([]));
    mockPendingAcceptance.mockResolvedValue([pendingGoal()]);

    const { result } = await mount();
    const card = itemOfKind(result, 'goal');
    expect(card.id).toBe('goal:goal-1');
    expect(card.title).toBe('Merge the two onboarding flows');
    expect(mockPendingAcceptance).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.decide({ item: card, verdict: 'accept' });
    });

    // Through the SLICE, not `devApi` — it owns the row write and the pending
    // count, and no seen-status because goals have no compare-and-swap.
    expect(mockAcceptGoal).toHaveBeenCalledWith('goal-1');
    expect(result.current.items).toHaveLength(0);
    expect(result.current.decidedCount).toBe(1);
    // A goal verdict invalidates the goal ledger, so it is re-read the way a
    // proposal verdict re-reads the proposal ones.
    await waitFor(() => expect(mockPendingAcceptance).toHaveBeenCalledTimes(2));
  });

  it('sends a goal back with the reviewer’s reason attached', async () => {
    mockTriageIdeas.mockResolvedValue(page([]));
    mockPendingAcceptance.mockResolvedValue([pendingGoal()]);

    const { result } = await mount();
    await act(async () => {
      await result.current.decide({
        item: itemOfKind(result, 'goal'),
        verdict: 'reject',
        reason: 'The KPI never moved',
      });
    });

    // The comment is the only account the team gets of why finished work came
    // back, so a dropped reason is a silent regression.
    expect(mockRejectGoal).toHaveBeenCalledWith('goal-1', 'The KPI never moved');
    expect(result.current.items).toHaveLength(0);
  });

  it('restores the goal card when the sign-off write fails', async () => {
    mockTriageIdeas.mockResolvedValue(page([]));
    mockPendingAcceptance.mockResolvedValue([pendingGoal()]);
    mockAcceptGoal.mockRejectedValueOnce(new Error('database is locked'));

    const { result } = await mount();
    const card = itemOfKind(result, 'goal');

    await act(async () => {
      await result.current.decide({ item: card, verdict: 'accept' });
    });

    // The whole point of A0's rethrow: a swallowed failure would leave the goal
    // `awaiting_acceptance` while the card left the queue for good.
    expect(result.current.items.map((i) => i.id)).toEqual([card.id]);
    expect(result.current.decidedCount).toBe(0);
    expect(mockToastCatch).toHaveBeenCalledTimes(1);
  });

  it('hands each card its KPI-mates so the batch branch can offer them', async () => {
    mockTriageIdeas.mockResolvedValue(page([]));
    mockPendingAcceptance.mockResolvedValue([
      pendingGoal(),
      pendingGoal({ goal_id: 'goal-2', title: 'Ship the second half' }),
      // A different KPI, and a goal on none at all — neither belongs in the
      // batch, and grouping the whole ledger as one would sign both off.
      pendingGoal({ goal_id: 'goal-3', kpi_id: 'kpi-2' }),
      pendingGoal({ goal_id: 'goal-4', kpi_id: null, kpi_name: null }),
    ]);

    const { result } = await mount();
    const first = result.current.items.find((i) => i.id === 'goal:goal-1')!;
    expect(first.payload?.batchGoalIds).toBe('goal-1,goal-2');

    await act(async () => {
      await result.current.decide({
        item: first,
        verdict: 'accept',
        branchId: 'accept-kpi-batch',
      });
    });

    expect(mockAcceptGoal).toHaveBeenCalledTimes(2);
    expect(mockAcceptGoal).toHaveBeenCalledWith('goal-1');
    expect(mockAcceptGoal).toHaveBeenCalledWith('goal-2');
    // The siblings were signed off but their cards are still in the deck, so
    // the re-read is what stops the next verdict writing into a decided goal.
    await waitFor(() => expect(mockPendingAcceptance).toHaveBeenCalledTimes(2));
  });

  it('offers no batch branch to the only goal on its KPI', async () => {
    mockTriageIdeas.mockResolvedValue(page([]));
    mockPendingAcceptance.mockResolvedValue([pendingGoal(), pendingGoal({ goal_id: 'goal-3', kpi_id: 'kpi-2' })]);

    const { result } = await mount();
    const lone = result.current.items.find((i) => i.id === 'goal:goal-3')!;
    // "Accept all 1 from this KPI" is the plain Accept under a second name.
    expect(lone.branches.map((b) => b.id)).toEqual(['open-board']);
    expect(lone.payload?.batchGoalIds).toBeUndefined();
  });

  it('reaches the host’s goals-board route without writing anything', async () => {
    mockTriageIdeas.mockResolvedValue(page([]));
    mockPendingAcceptance.mockResolvedValue([pendingGoal()]);
    const onOpenGoalBoard = vi.fn();

    const { result } = await mount({ onOpenGoalBoard });
    await act(async () => {
      await result.current.decide({
        item: itemOfKind(result, 'goal'),
        verdict: 'accept',
        branchId: 'open-board',
      });
    });

    expect(onOpenGoalBoard).toHaveBeenCalledWith('proj-1');
    expect(mockAcceptGoal).not.toHaveBeenCalled();
    expect(mockRejectGoal).not.toHaveBeenCalled();
  });

  it('keeps the deck usable when the goal ledger is unavailable', async () => {
    // Fetched in its own effect for exactly this: one source being down must
    // not take the rest of the queue with it.
    mockPendingAcceptance.mockRejectedValue(new Error('command not found'));
    const { result } = await mount();
    expect(result.current.items.map((i) => i.kind)).toEqual(['idea']);
    expect(mockToastCatch).toHaveBeenCalledWith('Could not load goals awaiting acceptance', expect.any(Error));
  });
});

describe('useUnifiedTriage — a source that did not answer is REPORTED, not swallowed', () => {
  it('names the failed source instead of settling on an empty queue', async () => {
    // Every source used to end in `.catch(toastCatch(…))`, so a total outage
    // settled `loading:false` with `items: []` — indistinguishable from a
    // cleared deck, which is what the deck then rendered.
    mockTriageIdeas.mockRejectedValue(new Error('command not found'));
    const { result } = await mount();

    expect(result.current.items).toHaveLength(0);
    expect(result.current.failures.map((f) => f.source)).toEqual(['ideas']);
    expect(result.current.failures[0]!.message).toContain('command not found');
  });

  it('reports a PARTIAL failure while still dealing everything that loaded', async () => {
    mockPolicyList.mockRejectedValue(new Error('policy ledger unavailable'));
    const { result } = await mount();

    expect(result.current.items.map((i) => i.kind)).toEqual(['idea']);
    expect(result.current.failures.map((f) => f.source)).toEqual(['policy']);
  });

  it('mirrors the two sources it does not own the fetch for', async () => {
    // Reviews arrive through `usePendingInteractions` and practices through
    // `useWorkspaceCenter`; both report failure as a VALUE, and both used to
    // reach the deck as "nothing of this kind is waiting".
    interactions.reviewsError = 'reviews are unreadable';
    workspaceCenter.knowledgeError = 'knowledge is unreadable';
    const { result } = await mount();

    expect(result.current.failures.map((f) => f.source).sort()).toEqual([
      'practices',
      'reviews',
    ]);
  });

  it('clears a failure once the source answers again', async () => {
    mockTriageIdeas.mockRejectedValueOnce(new Error('locked'));
    const { result } = await mount();
    expect(result.current.failures).toHaveLength(1);

    mockTriageIdeas.mockResolvedValue(page([idea()]));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.failures).toHaveLength(0));
  });
});

describe('useUnifiedTriage — a capped source is not a finished queue', () => {
  it('flags a fixed-limit ledger that came back FULL', async () => {
    // 50 rows out of a `limit: 50` query says nothing about row 51, and the
    // deck must not answer that with "nothing is waiting on you".
    mockPromotionList.mockResolvedValue(
      Array.from({ length: 50 }, (_, i) => promotion({ id: `prop-${i}` })),
    );
    const { result } = await mount();

    expect(result.current.backlog.capped).toEqual(['evolution']);
    expect(result.current.backlog.more).toBe(true);
    // Nothing can SIZE it, so no number is invented.
    expect(result.current.backlog.remaining).toBe(0);
  });

  it('leaves a short page uncapped', async () => {
    mockPromotionList.mockResolvedValue([promotion()]);
    const { result } = await mount();
    expect(result.current.backlog.capped).toEqual([]);
    expect(result.current.backlog.more).toBe(false);
  });

  it('still reports the exact idea remainder the keyset page knows', async () => {
    mockTriageIdeas.mockResolvedValue({
      ideas: [idea()],
      cursor: 'c1',
      hasMore: true,
      counts: { pending: 400, accepted: 0, rejected: 0, archived: 0, total: 400 },
    });
    const { result } = await mount();

    expect(result.current.backlog.remaining).toBe(399);
    expect(result.current.backlog.more).toBe(true);
  });
});

describe('useUnifiedTriage — the filtered ending has a way back', () => {
  it('puts every kind back in play, including the one toggle refuses to restore', async () => {
    const { result } = await mount();
    act(() => result.current.toggleKind('idea'));
    expect(result.current.activeKinds.has('idea')).toBe(false);

    act(() => result.current.showAllKinds());
    expect([...result.current.activeKinds].sort()).toEqual([...TRIAGE_KINDS].sort());
  });
});

describe('useUnifiedTriage — opening the deck does not write the session back', () => {
  it('serialises NOTHING on mount, and once per change after it', async () => {
    // Three effects (skips / kinds / resolved) all fired on mount, and at mount
    // those values are exactly what `loadTriageSession` had just read out of
    // storage — three full read-modify-write `JSON.stringify` passes to store
    // byte-identical state, every time the deck is opened. (And the deck is
    // remounted whenever the header overlay changes.)
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    // The decision JOURNAL persists to its own key on the same call path; this
    // assertion is about the session record alone.
    const sessionWrites = () =>
      writes.mock.calls.filter(([key]) => String(key).includes('triage.session')).length;
    try {
      const { result } = await mount();
      expect(sessionWrites()).toBe(0);

      await act(async () => {
        await result.current.decide({ item: itemOfKind(result, 'idea'), verdict: 'skip' });
      });
      // One skip, one write — not one per piece of session state.
      expect(sessionWrites()).toBe(1);
    } finally {
      writes.mockRestore();
    }
  });

  it('keeps the session start across the close now that the mount write is gone', async () => {
    // The mount write used to be what stamped `startedAt`; the hook passes it
    // explicitly instead. Without that, the session began at the first DECISION
    // and the summary reported zero for a sitting that had just recorded one.
    const first = await mount();
    await act(async () => {
      await first.result.current.decide({
        item: itemOfKind(first.result, 'idea'),
        verdict: 'accept',
      });
    });
    first.unmount();

    const second = await mount();
    expect(second.result.current.summary.decided).toBe(1);
  });
});
