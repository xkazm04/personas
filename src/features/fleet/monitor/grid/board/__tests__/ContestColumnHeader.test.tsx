/**
 * ContestColumnHeader — a contest column's header is the way back to its race.
 *
 * The contest page links INTO the Monitor ("Watch in Monitor"); this is the
 * reverse door. Three claims: the header names the contest by its title when
 * the contest list cache knows it (the id otherwise), a click focuses exactly
 * that (project, contest), and a seat whose label predates the project cannot
 * say which arena it belongs to, so its header is inert and names the id.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';
import { useContestFocus } from '@/features/plugins/dev-tools/contest/focus';
import {
  __resetContestStoreForTests, contestListSlots,
} from '@/features/plugins/dev-tools/contest/hooks/contestStore';

import { ContestColumnHeader } from '../ContestColumnHeader';

const summary = (projectId: string, contestId: string, title: string): ContestSummary =>
  ({ projectId, projectName: projectId, contestId, title } as unknown as ContestSummary);

function primeList(rows: ContestSummary[]): void {
  contestListSlots.set('all', { data: rows, loading: false, error: null });
  contestListSlots.notify();
}

afterEach(() => {
  __resetContestStoreForTests();
  useContestFocus.setState({ focused: null });
});

describe('ContestColumnHeader', () => {
  it('names the contest by the title of ITS project, not a same-id contest elsewhere', () => {
    primeList([
      summary('p-alpha', 'onboarding', 'Onboarding, alpha'),
      summary('p-beta', 'onboarding', 'Onboarding, beta'),
    ]);
    render(<ContestColumnHeader projectId="p-beta" contestId="onboarding" seats={3} />);
    const header = screen.getByTestId('fleet-grid-column-header');
    expect(header.textContent).toContain('Onboarding, beta');
    expect(header.textContent).not.toContain('alpha');
    expect(header.textContent).toContain('3');
  });

  it('falls back to the id while the list cache does not know the contest', () => {
    render(<ContestColumnHeader projectId="p-alpha" contestId="home-hero" seats={1} />);
    expect(screen.getByTestId('fleet-grid-column-header').textContent).toContain('home-hero');
  });

  it('focuses its own contest on click', async () => {
    primeList([summary('p-beta', 'onboarding', 'Onboarding, beta')]);
    render(<ContestColumnHeader projectId="p-beta" contestId="onboarding" seats={1} />);
    const header = screen.getByTestId('fleet-grid-column-header');
    expect(header.tagName).toBe('BUTTON');
    await userEvent.click(header);
    expect(useContestFocus.getState().focused).toEqual({ projectId: 'p-beta', contestId: 'onboarding' });
  });

  it('is inert for a seat labelled before the project joined the label', () => {
    render(<ContestColumnHeader projectId={null} contestId="onboarding" seats={2} />);
    const header = screen.getByTestId('fleet-grid-column-header');
    expect(header).toBeDisabled();
    expect(header.textContent).toContain('onboarding');
    expect(useContestFocus.getState().focused).toBeNull();
  });
});
