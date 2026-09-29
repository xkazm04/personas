// New contest: typed seats, the receipt, the kept draft, the Athena draft that
// asks before overwriting a written brief, and the line-up states.
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Under a full parallel run the first paint of a lazy-loaded section can take
// longer than testing-library's 1 s default; the flows below are real renders.
configure({ asyncUtilTimeout: 5000 });

import { ledgerFixture, summaryFixture } from './fixtures';

const api = vi.hoisted(() => ({
  getContestLineups: vi.fn(async () => [] as { name: string; seats: string[] }[]),
  setContestLineups: vi.fn(async () => null),
  createContest: vi.fn(),
  draftContestBrief: vi.fn(),
}));
vi.mock('@/api/contest', () => api);

import { __resetContestStoreForTests } from '../hooks/contestStore';
import { clearSetupDraft } from '../model/setupDraft';
import { SetupDrawer } from '../ledger/SetupDrawer';
import { useSystemStore } from '@/stores/systemStore';

const past = [
  summaryFixture({
    contestId: 'old',
    variantsPerSeat: 3,
    ledger: ledgerFixture({
      seats: [
        { seatId: 'a', spec: 'claude:claude-opus-5-5@xhigh', kind: 'participant', state: 'completed', fleetSessionId: null, letter: 'A', wallS: 1500, costUsd: 18, turns: 80, errors: [], startedAtMs: 1 },
      ],
    }),
  }),
];

function renderDrawer(onClose = vi.fn(), onCreated = vi.fn()) {
  render(<SetupDrawer contests={past} defaultProjectId="p1" wide={false} onClose={onClose} onCreated={onCreated} />);
  return { onClose, onCreated };
}

beforeEach(() => {
  __resetContestStoreForTests();
  clearSetupDraft();
  useSystemStore.setState({ projects: [{ id: 'p1', name: 'Personas', root_path: 'C:/p1' }] as never, fetchProjects: vi.fn() as never });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const typeSeat = (text: string) => {
  const input = screen.getByTestId('ledger-seat-command');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
};

describe('New contest', () => {
  it('"opus x" adds Opus 5.5 at Extra high, and the receipt prices it from past runs', async () => {
    renderDrawer();
    typeSeat('opus x');
    expect(await screen.findByTestId('ledger-seatline-claude:claude-opus-5-5@xhigh')).toBeInTheDocument();
    const receipt = screen.getByTestId('ledger-receipt');
    expect(within(receipt).getByText('Likely cost')).toBeInTheDocument();
    expect(receipt.textContent).toContain('$18.00');
  });

  it('creates with the typed seats and launches when asked', async () => {
    api.createContest.mockResolvedValue(summaryFixture({ contestId: 'new-one' }));
    const { onCreated } = renderDrawer();
    fireEvent.change(screen.getByTestId('ledger-setup-title'), { target: { value: 'Pricing page' } });
    fireEvent.change(screen.getByTestId('ledger-setup-brief'), { target: { value: 'Build a pricing page.' } });
    typeSeat('opus x');
    typeSeat('sol');
    fireEvent.click(screen.getByTestId('ledger-setup-create-launch'));
    await waitFor(() => expect(api.createContest).toHaveBeenCalled());
    const req = api.createContest.mock.calls[0]![0];
    expect(req).toMatchObject({ projectId: 'p1', title: 'Pricing page', launch: true, judgesEnabled: false });
    expect(req.seats.map((s: { model: string; effort: string }) => `${s.model}@${s.effort}`)).toEqual(['claude-opus-5-5@xhigh', 'gpt-6-sol@high']);
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it('the form comes back as it was left after a close', async () => {
    renderDrawer();
    fireEvent.change(screen.getByTestId('ledger-setup-title'), { target: { value: 'Kept title' } });
    cleanup();
    renderDrawer();
    expect(screen.getByTestId('ledger-setup-title')).toHaveValue('Kept title');
  });

  it('drafting over a written brief asks first, and only then spends the call', async () => {
    api.draftContestBrief.mockResolvedValue({ brief: 'Drafted brief' });
    renderDrawer();
    fireEvent.change(screen.getByTestId('ledger-setup-brief'), { target: { value: 'My own words' } });
    fireEvent.change(screen.getByLabelText('One-line idea'), { target: { value: 'a pricing page' } });
    fireEvent.click(screen.getByTestId('ledger-setup-draft'));
    expect(api.draftContestBrief).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Replace the brief' }));
    await waitFor(() => expect(api.draftContestBrief).toHaveBeenCalledWith('p1', 'a pricing page'));
    await waitFor(() => expect(screen.getByTestId('ledger-setup-brief')).toHaveValue('Drafted brief'));
  });

  it('a failed line-up read is not "No saved line-ups yet"', async () => {
    api.getContestLineups.mockRejectedValueOnce(new Error('database is locked'));
    renderDrawer();
    expect(await screen.findByText('Could not read the saved line-ups.')).toBeInTheDocument();
    expect(screen.queryByText('No saved line-ups yet.')).toBeNull();
  });

  it('an empty line-up read says so, and a saved line-up fills the panel in one click', async () => {
    renderDrawer();
    expect(await screen.findByText('No saved line-ups yet.')).toBeInTheDocument();
    cleanup();
    __resetContestStoreForTests();
    api.getContestLineups.mockResolvedValueOnce([{ name: 'Frontier', seats: ['claude:claude-opus-5-5@xhigh', 'codex:gpt-6-sol@high'] }]);
    renderDrawer();
    fireEvent.click(await screen.findByTestId('ledger-lineup-Frontier'));
    expect(screen.getByTestId('ledger-seatline-codex:gpt-6-sol@high')).toBeInTheDocument();
  });
});
