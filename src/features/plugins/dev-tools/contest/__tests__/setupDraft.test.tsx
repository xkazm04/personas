// "New race" keeps its input across a close (FE-8): a stray Escape or backdrop
// click never throws a brief away, and an Athena draft never silently replaces
// a brief the owner wrote.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getContestEnvironment: vi.fn(),
  getContestLineups: vi.fn(),
  setContestLineups: vi.fn(async () => null),
  createContest: vi.fn(),
  draftContestBrief: vi.fn(),
}));
vi.mock('@/api/contest', () => api);

import { useSystemStore } from '@/stores/systemStore';

import { SetupDrawer } from '../arena/SetupDrawer';
import { SetupForm } from '../components/SetupForm';
import { __resetContestStoreForTests } from '../hooks/contestStore';
import { clearSetupDraft } from '../model/setupDraft';

beforeEach(() => {
  __resetContestStoreForTests();
  clearSetupDraft();
  useSystemStore.setState({ fetchProjects: async () => {} });
  api.getContestEnvironment.mockResolvedValue({
    node: true, instrumentPath: 'x', engines: { claude: true, codex: true, grok: true }, playwright: true, problems: [],
  });
  api.getContestLineups.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const type = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });

describe('setup draft', () => {
  it('the form comes back as it was left after a close', () => {
    const first = render(<SetupForm defaultProjectId="p1" />);
    type('contest-setup-title', 'Aurora');
    type('contest-setup-brief', '## The idea\nA dome.');
    first.unmount();
    render(<SetupForm defaultProjectId="p1" />);
    expect(screen.getByTestId('contest-setup-title')).toHaveValue('Aurora');
    expect(screen.getByTestId('contest-setup-brief')).toHaveValue('## The idea\nA dome.');
  });

  it('drafting over a written brief asks first, and only then spends the call', async () => {
    api.draftContestBrief.mockResolvedValue({ brief: 'Drafted.' });
    render(<SetupForm defaultProjectId="p1" />);
    type('contest-setup-brief', 'My own words.');
    type('contest-setup-idea', 'a planetarium');
    await act(async () => {
      fireEvent.click(screen.getByTestId('contest-setup-draft'));
    });
    expect(api.draftContestBrief).not.toHaveBeenCalled();
    expect(screen.getByTestId('contest-setup-brief')).toHaveValue('My own words.');
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Replace the brief' }));
    });
    await waitFor(() => expect(screen.getByTestId('contest-setup-brief')).toHaveValue('Drafted.'));
    expect(api.draftContestBrief).toHaveBeenCalledTimes(1);
  });

  it('Escape on a dirty drawer asks before closing', async () => {
    const onClose = vi.fn();
    render(<SetupDrawer defaultProjectId="p1" onClose={onClose} />);
    type('contest-setup-title', 'Aurora');
    await act(async () => {
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Close the setup' }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape on an untouched drawer just closes', async () => {
    const onClose = vi.fn();
    render(<SetupDrawer defaultProjectId="p1" onClose={onClose} />);
    await act(async () => {
      fireEvent.keyDown(document.body, { key: 'Escape' });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
