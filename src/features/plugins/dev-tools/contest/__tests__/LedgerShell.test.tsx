// The Season Ledger over a mocked contest API: the ledger rows, the camera into
// a contest (seats, chain, decision, bench) and into a variant, the keys, and
// every action that spends or decides (launch, stop, rerun, retry, declare).
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Under a full parallel run the first paint of a lazy-loaded section can take
// longer than testing-library's 1 s default; the flows below are real renders.
configure({ asyncUtilTimeout: 5000 });

import type { ContestDetail } from '@/lib/bindings/ContestDetail';

import { detailFixture, ledgerFixture, summaryFixture } from './fixtures';

const api = vi.hoisted(() => ({
  listContests: vi.fn(),
  getContest: vi.fn(),
  getContestEnvironment: vi.fn(),
  getContestLineups: vi.fn(async () => []),
  setContestLineups: vi.fn(async () => null),
  saveContestReview: vi.fn(async () => null),
  createContest: vi.fn(),
  launchContest: vi.fn(async () => null),
  cancelContest: vi.fn(async () => null),
  decideContest: vi.fn(),
  runContestStep: vi.fn(async () => null),
  draftContestBrief: vi.fn(),
}));
vi.mock('@/api/contest', () => api);

import { focusContest, useContestFocus } from '../focus';
import { __resetContestStoreForTests } from '../hooks/contestStore';
import LedgerShell from '../ledger';

/** A detail whose summary carries the same ledger projection the backend builds. */
function withLedger(d: ContestDetail): ContestDetail {
  const summary = {
    ...d.summary,
    ledger: ledgerFixture({
      timeoutMin: d.timeoutMin,
      notBeforeMs: d.notBeforeMs,
      judgesEnabled: d.judgesEnabled,
      chain: d.chain,
      seats: d.seats.filter((s) => s.kind === 'participant'),
      variants: d.variants.map((v) => ({ key: v.key, seatId: v.seatId, n: v.n, present: v.present, title: v.title, concept: v.concept, still: null, bucket: d.review?.variants.find((r) => r.key === v.key)?.bucket ?? null })),
    }),
  };
  return { ...d, summary };
}

const review = withLedger(detailFixture({ summary: summaryFixture({ contestId: 'hero-page', title: 'Hero page', phase: 'review' }) }));
const running = withLedger(
  detailFixture({
    summary: summaryFixture({ contestId: 'race-1', title: 'Pricing page', phase: 'running' }),
    seats: [
      { ...detailFixture().seats[0]!, state: 'running', wallS: null, costUsd: null, startedAtMs: Date.now() - 60_000 },
      { ...detailFixture().seats[1]!, state: 'queued', errors: [] },
    ],
    variants: [],
    chain: { step: 'idle', reason: null, updatedAtMs: null },
  }),
);
const draft = withLedger(
  detailFixture({
    summary: summaryFixture({ contestId: 'draft-1', title: 'Onboarding', phase: 'draft' }),
    seats: detailFixture().seats.map((s) => ({ ...s, state: 'idle' as const, wallS: null, costUsd: null, errors: [], fleetSessionId: null })),
    variants: [],
    chain: { step: 'idle', reason: null, updatedAtMs: null },
  }),
);
const failed = withLedger(
  detailFixture({
    summary: summaryFixture({ contestId: 'broke', title: 'Broken run', phase: 'failed' }),
    variants: [],
    chain: { step: 'failed', reason: 'collect: 0 of 2 seats delivered a variant', updatedAtMs: null },
  }),
);
const decided = withLedger(
  detailFixture({
    summary: summaryFixture({ contestId: 'done', title: 'Settled one', phase: 'decided', winner: 'A/1', winnerSeatSpec: 'claude:claude-opus-5-5@xhigh', date: '2026-09-20' }),
  }),
);
const ALL = [review, running, draft, failed, decided];

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  __resetContestStoreForTests();
  useContestFocus.setState({ focused: null, focusSeq: 0 });
  api.getContestEnvironment.mockResolvedValue({ node: true, instrumentPath: 'x', engines: { claude: true, codex: true, grok: true }, playwright: true, problems: [] });
  api.listContests.mockResolvedValue(ALL.map((d) => d.summary));
  api.getContest.mockImplementation(async (_p: string, c: string) => ALL.find((d) => d.summary.contestId === c)!);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function openContest(id: string) {
  render(<LedgerShell />);
  fireEvent.click(await screen.findByTestId(`ledger-row-${id}`));
  await screen.findByTestId('ledger-contest-title');
}

describe('the ledger', () => {
  it('lists every contest on one line, grouped by what it asks of the owner', async () => {
    render(<LedgerShell />);
    const ledger = await screen.findByTestId('ledger');
    const groups = within(ledger).getAllByRole('rowgroup').map((g) => g.getAttribute('aria-label'));
    expect(groups).toEqual(['Needs your verdict', 'Running & scheduled', 'Settled']);
    expect(within(ledger).getByText('Hero page')).toBeInTheDocument();
    expect(within(ledger).getByText('Pricing page')).toBeInTheDocument();
    // A strand per seat and a verdict in words.
    const hero = screen.getByTestId('ledger-row-hero-page');
    expect(within(hero).getByTestId('ledger-strand-claude-claude-opus-5-5_xhigh')).toBeInTheDocument();
    expect(within(hero).getByTestId('ledger-strand-codex-gpt-6-sol_high')).toBeInTheDocument();
    expect(within(screen.getByTestId('ledger-row-done')).getByText('A/1')).toBeInTheDocument();
  });

  it('the attention filter narrows the ledger and Escape clears it', async () => {
    render(<LedgerShell />);
    await screen.findByTestId('ledger-row-hero-page');
    fireEvent.click(screen.getByTestId('ledger-filter-running'));
    expect(screen.queryByTestId('ledger-row-hero-page')).toBeNull();
    expect(screen.getByTestId('ledger-row-race-1')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(await screen.findByTestId('ledger-row-hero-page')).toBeInTheDocument();
  });

  it('arrow keys walk the rows and Enter opens the focused contest', async () => {
    render(<LedgerShell />);
    await screen.findByTestId('ledger-row-hero-page');
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(screen.getByTestId('ledger-row-hero-page')).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(await screen.findByTestId('ledger-contest-title')).toHaveTextContent('Hero page');
  });
});

describe('a contest', () => {
  it('running: a dial per seat, the chain waits, and Stop cancels only after the confirm', async () => {
    await openContest('race-1');
    expect(screen.getByTestId('ledger-dial-claude-claude-opus-5-5_xhigh')).toBeInTheDocument();
    expect(screen.getByTestId('ledger-station-collect')).toHaveAttribute('data-status', 'pending');
    fireEvent.click(screen.getByTestId('ledger-cancel'));
    expect(api.cancelContest).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Stop the contest' }));
    await waitFor(() => expect(api.cancelContest).toHaveBeenCalledWith('p1', 'race-1'));
  });

  it('a draft starts its participants', async () => {
    await openContest('draft-1');
    fireEvent.click(screen.getByTestId('ledger-launch'));
    await waitFor(() => expect(api.launchContest).toHaveBeenCalledWith('p1', 'draft-1', 'participant'));
  });

  it('a seat that hit its plan limit reruns alone, with its own kind', async () => {
    await openContest('hero-page');
    fireEvent.click(await screen.findByTestId('ledger-rerun-codex-gpt-6-sol_high'));
    await waitFor(() => expect(api.launchContest).toHaveBeenCalledWith('p1', 'hero-page', 'participant', ['codex-gpt-6-sol_high']));
  });

  it('a failed chain offers a retry of the step it names', async () => {
    await openContest('broke');
    expect(screen.getByTestId('ledger-chain-reason')).toHaveTextContent('0 of 2 seats delivered');
    fireEvent.click(screen.getByTestId('ledger-retry-collect'));
    await waitFor(() => expect(api.runContestStep).toHaveBeenCalledWith('p1', 'broke', 'collect'));
  });

  it('decided is read only and names its winner', async () => {
    await openContest('done');
    expect(screen.getByTestId('ledger-decision-locked')).toHaveTextContent('A/1');
    expect(screen.queryByTestId('ledger-rerun-codex-gpt-6-sol_high')).toBeNull();
  });

  it('an outside focus opens the contest; 1 sorts the focused card into Winner and Declare sends it', async () => {
    api.decideContest.mockResolvedValue({ ...review.summary, phase: 'decided', winner: 'A/1' });
    render(<LedgerShell />);
    await screen.findByTestId('ledger-row-hero-page');
    act(() => focusContest({ projectId: 'p1', contestId: 'hero-page' }));
    const bench = await screen.findByTestId('ledger-bench');
    await waitFor(() => expect(within(bench).getByTestId('ledger-card-A/1')).toHaveClass('focus'));
    fireEvent.keyDown(window, { key: '1' });
    await waitFor(() => expect(within(screen.getByTestId('ledger-tray-winner')).getByTestId('ledger-card-A/1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('ledger-decide-winner'));
    const confirm = await screen.findByRole('dialog');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Declare winner' }));
    await waitFor(() =>
      expect(api.decideContest).toHaveBeenCalledWith('p1', 'hero-page', expect.objectContaining({ kind: 'winner', winner: 'A/1', runnerUp: null })),
    );
    // The review was flushed first: REVIEW.md is what a refine reads.
    expect(api.saveContestReview).toHaveBeenCalled();
  });

  it('Escape pulls the camera back to the ledger', async () => {
    await openContest('race-1');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('ledger-row-race-1').closest('section')).not.toHaveAttribute('hidden'));
  });
});

describe('a variant', () => {
  it('Enter opens the focused card; arrows step the variants; a key typed in the note stays in the note', async () => {
    await openContest('hero-page');
    await waitFor(() => expect(screen.getByTestId('ledger-card-A/1')).toHaveClass('focus'));
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(await screen.findByTestId('ledger-variant-title')).toHaveTextContent('A/1');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByTestId('ledger-variant-title')).toHaveTextContent('B/1');
    const note = screen.getByTestId('ledger-variant-note');
    note.focus();
    fireEvent.keyDown(note, { key: 'ArrowLeft' });
    expect(screen.getByTestId('ledger-variant-title')).toHaveTextContent('B/1');
  });
});
