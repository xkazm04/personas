import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';

// DW-254. After the questionnaire, the answers are written to the build session,
// and test and promote read them from there. The real view, store, build surface
// and banner are mounted. Stubbed: IPC at its API seam, the pre-seed questionnaire
// (only its Continue is needed), and the build and lifecycle hooks, which would
// otherwise run a real test.

// Bypass IPC token wait.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));

const api = vi.hoisted(() => ({
  saveAdoptionAnswers: vi.fn<(sessionId: string, json: string) => Promise<void>>(),
  createAdoptionSession: vi.fn<() => Promise<string>>(),
  adjustAdoptionDraft: vi.fn<(sessionId: string) => Promise<void>>(),
  handleStartTest: vi.fn<() => Promise<void>>(),
}));

vi.mock('@/api/agents/buildSession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/agents/buildSession')>()),
  saveAdoptionAnswers: api.saveAdoptionAnswers,
  createAdoptionSession: api.createAdoptionSession,
}));
vi.mock('@/api/templates/templateAdopt', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/templates/templateAdopt')>()),
  adjustAdoptionDraft: api.adjustAdoptionDraft,
}));
vi.mock('@/stores/overviewStore', () => ({
  useOverviewStore: {
    getState: () => ({
      processStarted: () => {},
      processEnded: () => {},
      updateProcessStatus: () => {},
    }),
  },
}));
vi.mock('../persona-layout', () => ({
  PersonaLayoutAdoption: ({ onContinue }: { onContinue: () => void }) => (
    <button type="button" onClick={onContinue}>
      Continue
    </button>
  ),
}));
vi.mock('../CompositionXray', () => ({ CompositionXray: () => null }));
vi.mock('@/features/agents/components/matrix/useBuild', async () => {
  const { useAgentStore: store } = await import('@/stores/agentStore');
  const build = {
    completeness: 100,
    isBuilding: false,
    buildActivity: null,
    cellStates: {},
    pendingQuestions: null,
    buildError: null,
    buildTestOutputLines: [],
    buildTestPassed: null,
    buildTestError: null,
    handleAnswer: () => {},
  };
  return {
    useBuild: () => ({ ...build, buildPhase: store.getState().buildPhase }),
  };
});
vi.mock('@/features/agents/components/matrix/useLifecycle', () => {
  const lifecycle = {
    handleStartTest: api.handleStartTest,
    handlePromote: async () => {},
    handleRejectTest: () => {},
    handleRefine: async () => {},
    buildToolTestResults: [],
    buildTestSummary: null,
  };
  return { useLifecycle: () => lifecycle };
});

import { useAgentStore } from '@/stores/agentStore';
import { ChronologyAdoptionView } from '../ChronologyAdoptionView';

// An IPC rejection is a serialized AppError object, never an `Error`.
const REASON = 'Answer for "Workspace" is not one of the allowed options';
const REJECTION = { error: REASON, kind: 'validation' };

const QUESTION = {
  id: 'q_workspace',
  question: 'Which workspace?',
  category: 'configuration',
  type: 'select',
  options: ['alpha', 'beta'],
  default: 'alpha',
};

const reviewFor = (questions: unknown[]) =>
  ({
    id: 'review-254',
    test_case_name: 'Digest',
    instruction: 'Send a digest',
    design_result: JSON.stringify({
      name: 'Digest',
      use_cases: [{ id: 'uc_digest', title: 'Morning digest', description: 'digest' }],
      adoption_questions: questions,
    }),
  }) as unknown as PersonaDesignReview;

const retryButton = () => screen.queryByRole('button', { name: /retry/i });

/** Mount the view and answer "Continue", which commits the questionnaire. */
function completeQuestionnaire(questions: unknown[] = [QUESTION]) {
  render(
    <ChronologyAdoptionView
      review={reviewFor(questions)}
      onClose={() => {}}
      onPersonaCreated={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

/** Let the rejection, and anything chained on it, settle. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

describe('adoption answers that fail to save', () => {
  beforeEach(() => {
    window.localStorage.clear();
    api.saveAdoptionAnswers.mockReset().mockResolvedValue(undefined);
    api.createAdoptionSession.mockReset().mockResolvedValue('sess-254');
    api.adjustAdoptionDraft.mockReset().mockResolvedValue(undefined);
    api.handleStartTest.mockReset().mockResolvedValue(undefined);
    useAgentStore.getState().resetBuildSession();
    useAgentStore.setState({
      createPersona: vi.fn(async () => ({ id: 'persona-254' })),
    } as never);
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the rejection reason and a Retry control', async () => {
    api.saveAdoptionAnswers.mockRejectedValue(REJECTION);
    completeQuestionnaire();
    await waitFor(() => expect(api.saveAdoptionAnswers).toHaveBeenCalledTimes(1));

    expect(await screen.findByText(REASON)).toBeInTheDocument();
    expect(retryButton()).toBeInTheDocument();
  });

  it('retries with the same payload and clears the message when it succeeds', async () => {
    api.saveAdoptionAnswers.mockRejectedValueOnce(REJECTION).mockResolvedValue(undefined);
    completeQuestionnaire();
    await screen.findByText(REASON);
    expect(api.saveAdoptionAnswers).toHaveBeenCalledTimes(1);

    fireEvent.click(retryButton()!);

    await waitFor(() => expect(api.saveAdoptionAnswers).toHaveBeenCalledTimes(2));
    const [first, second] = api.saveAdoptionAnswers.mock.calls;
    expect(second).toEqual(first);
    expect(first![0]).toBe('sess-254');
    expect(JSON.parse(first![1]).answers).toEqual({ q_workspace: 'alpha' });

    await waitFor(() => expect(screen.queryByText(REASON)).not.toBeInTheDocument());
    expect(retryButton()).not.toBeInTheDocument();
  });

  it('does not let the build carry on past a rejected save', async () => {
    api.saveAdoptionAnswers.mockRejectedValueOnce(REJECTION).mockResolvedValue(undefined);
    completeQuestionnaire();
    await waitFor(() => expect(api.saveAdoptionAnswers).toHaveBeenCalledTimes(1));
    await settle();

    expect(api.adjustAdoptionDraft).not.toHaveBeenCalled();
    expect(api.handleStartTest).not.toHaveBeenCalled();

    // Recoverable: the same adoption continues once the retry lands.
    fireEvent.click((await screen.findByRole('button', { name: /retry/i })));
    await waitFor(() => expect(api.adjustAdoptionDraft).toHaveBeenCalledWith('sess-254'));
    await waitFor(() => expect(api.handleStartTest).toHaveBeenCalledTimes(1));
  });

  it('shows no error when the save succeeds, and the build carries on', async () => {
    completeQuestionnaire();
    await waitFor(() => expect(api.saveAdoptionAnswers).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.handleStartTest).toHaveBeenCalledTimes(1));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(retryButton()).not.toBeInTheDocument();
  });

  it('carries on when there is nothing to save', async () => {
    completeQuestionnaire([]);
    await waitFor(() => expect(api.handleStartTest).toHaveBeenCalledTimes(1));

    expect(api.saveAdoptionAnswers).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
