import { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';

// DW-253. Both routes that discard an adoption's draft agent. The real wizard
// modal, adoption view, build surface, confirm dialog and stores are mounted.
// Stubbed: IPC at its API seam, the pre-seed questionnaire (only its Continue is
// needed), and the build and lifecycle hooks, which would otherwise run a real test.

// Bypass IPC token wait.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/useTranslation')>()),
  useTranslation: () => ({ t: en, tx: (s: string) => s, language: 'en' }),
}));

const api = vi.hoisted(() => ({
  createAdoptionSession: vi.fn<() => Promise<string>>(),
  adjustAdoptionDraft: vi.fn<(sessionId: string) => Promise<void>>(),
  handleStartTest: vi.fn<() => Promise<void>>(),
}));

vi.mock('@/api/agents/buildSession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/agents/buildSession')>()),
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
    buildTestPassed: false,
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
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import AdoptionWizardModal from '../AdoptionWizardModal';

const PERSONA_ID = 'persona-253';
const SESSION_ID = 'sess-253';
// The store's deletePersona rejects with the IPC's serialized AppError.
const REASON = 'The draft agent is still referenced by a team';
const REJECTION = { error: REASON, kind: 'validation' };

const copy = en.templates.adopt_modal;

const REVIEW = {
  id: 'review-253',
  test_case_name: 'Digest',
  instruction: 'Send a digest',
  design_result: JSON.stringify({
    name: 'Digest',
    use_cases: [{ id: 'uc_digest', title: 'Morning digest', description: 'digest' }],
    adoption_questions: [],
  }),
} as unknown as PersonaDesignReview;

const deletePersona = vi.fn<(id: string) => Promise<void>>();
const onClose = vi.fn();

function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <AdoptionWizardModal
      isOpen={open}
      onClose={() => {
        onClose();
        setOpen(false);
      }}
      review={REVIEW}
      onPersonaCreated={() => {}}
    />
  );
}

/** Mount the modal and take the adoption to the given build phase. */
async function adoptTo(phase: 'failed' | 'test_complete') {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() => expect(api.handleStartTest).toHaveBeenCalledTimes(1));
  act(() => {
    useAgentStore.getState().patchActiveSession({ phase });
  });
}

const deleteDraftButton = () =>
  screen.findByRole('button', { name: en.templates.matrix_variants.delete_draft });

/** The header's close button. It has no accessible name of its own. */
const closeButton = () => {
  const header = screen.getByRole('heading', { name: copy.adopt_template }).closest('.justify-between');
  return within(header as HTMLElement).getByRole('button');
};

/** The dialog showing the existing discard copy, whichever line of it the fix uses. */
const confirmDialog = () => {
  const [line] = [...screen.queryAllByText(copy.discard_title), ...screen.queryAllByText(copy.discard_body)];
  return (line?.closest('[role="dialog"], [role="alertdialog"]') as HTMLElement | null | undefined) ?? null;
};
const shownConfirm = async () => {
  await waitFor(() => expect(confirmDialog()).not.toBeNull());
  return confirmDialog()!;
};
const pressConfirm = async () => {
  const dialog = await shownConfirm();
  fireEvent.click(within(dialog).getByRole('button', { name: /discard|delete|confirm/i }));
};
const pressCancel = async () => {
  const dialog = await shownConfirm();
  fireEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));
};

const reasonIsVisible = () =>
  useToastStore.getState().toasts.some((x) => x.message.includes(REASON)) ||
  screen.queryByText(new RegExp(REASON)) !== null;

const expectSessionCleanedUp = () => {
  expect(useAgentStore.getState().buildSessionId).toBeNull();
  expect(useSystemStore.getState().templateAdoptActive).toBe(false);
  expect(useSystemStore.getState().adoptionDraft).toBeNull();
};

beforeEach(() => {
  window.localStorage.clear();
  onClose.mockReset();
  deletePersona.mockReset().mockResolvedValue(undefined);
  api.createAdoptionSession.mockReset().mockResolvedValue(SESSION_ID);
  api.adjustAdoptionDraft.mockReset().mockResolvedValue(undefined);
  api.handleStartTest.mockReset().mockResolvedValue(undefined);
  useAgentStore.getState().resetBuildSession();
  useAgentStore.setState({
    createPersona: vi.fn(async () => ({ id: PERSONA_ID })),
    deletePersona,
  } as never);
  useToastStore.setState({ toasts: [] } as never);
});

afterEach(() => {
  cleanup();
});

// `Delete Draft` shows on both; only `failed` is a phase the modal's close treats
// as safe to skip its confirm, so a fix that leans on that route shows up here.
describe.each(['failed', 'test_complete'] as const)('Delete Draft after phase %s', (phase) => {
  it('asks first: nothing is deleted or closed on the press', async () => {
    await adoptTo(phase);
    fireEvent.click(await deleteDraftButton());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(deletePersona).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(await shownConfirm()).toBeInTheDocument();
  });

  it('cancelling keeps the draft and the modal', async () => {
    await adoptTo(phase);
    fireEvent.click(await deleteDraftButton());
    await pressCancel();

    await waitFor(() => expect(confirmDialog()).toBeNull());
    expect(deletePersona).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(useAgentStore.getState().buildSessionId).toBe(SESSION_ID);
    expect(await deleteDraftButton()).toBeInTheDocument();
  });

  it('confirming deletes the draft and closes, with one confirm', async () => {
    await adoptTo(phase);
    fireEvent.click(await deleteDraftButton());
    await pressConfirm();

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(deletePersona).toHaveBeenCalledTimes(1);
    expect(deletePersona).toHaveBeenCalledWith(PERSONA_ID);
    expect(reasonIsVisible()).toBe(false);
    expectSessionCleanedUp();
    await waitFor(() => expect(confirmDialog()).toBeNull());
  });

  it('a rejected delete shows its reason, and the session is still cleaned up', async () => {
    deletePersona.mockRejectedValue(REJECTION);
    await adoptTo(phase);
    fireEvent.click(await deleteDraftButton());
    await pressConfirm();

    await waitFor(() => expect(reasonIsVisible()).toBe(true));
    expect(deletePersona).toHaveBeenCalledWith(PERSONA_ID);
    expectSessionCleanedUp();
  });
});

describe('the close button', () => {
  it('confirming deletes the draft and closes', async () => {
    await adoptTo('test_complete');
    fireEvent.click(closeButton());
    expect(deletePersona).not.toHaveBeenCalled();
    await pressConfirm();

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(deletePersona).toHaveBeenCalledWith(PERSONA_ID);
    expect(reasonIsVisible()).toBe(false);
    expectSessionCleanedUp();
  });

  it('a rejected delete shows its reason, and the session is still cleaned up', async () => {
    deletePersona.mockRejectedValue(REJECTION);
    await adoptTo('test_complete');
    fireEvent.click(closeButton());
    await pressConfirm();

    await waitFor(() => expect(reasonIsVisible()).toBe(true));
    expect(deletePersona).toHaveBeenCalledWith(PERSONA_ID);
    expectSessionCleanedUp();
  });
});
