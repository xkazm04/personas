import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

/**
 * THE MAP SAYS "NO MEMBERS" ONLY WHEN THE ROSTER READ SAID SO.
 *
 * The topology read reset `members` to [] and rendered the settled empty state
 * ("No members in this project yet") whenever the list was empty: during every
 * team's read, and for good when the read failed (its catch was a silentCatch
 * and nothing else). A team with members was described as having none.
 */

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const listMembers = vi.fn();
const listConnections = vi.fn();
vi.mock('@/api/pipeline/teams', () => ({
  listTeamMembers: (...a: unknown[]) => listMembers(...a),
  listTeamConnections: (...a: unknown[]) => listConnections(...a),
}));
vi.mock('@/lib/silentCatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/silentCatch')>()),
  silentCatch: () => () => {},
}));
const t = new Proxy({}, { get: (_o, section) => new Proxy({}, { get: (_s, key) => `${String(section)}.${String(key)}` }) });
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s) }),
}));
const storeState: Record<string, unknown> = { channels: {}, subscribeChannel: () => () => {} };
vi.mock('@/stores/pipelineStore', () => ({
  usePipelineStore: (selector: (s: Record<string, unknown>) => unknown) => selector(storeState),
}));

const teams = [{ teamId: 'team-a', teamName: 'A', teamColor: '#888', members: [], selected: true }];

async function mount() {
  const { ChannelMap } = await import('../map/ChannelMap');
  return render(<ChannelMap teams={teams} onDrillIn={() => {}} />);
}

beforeEach(() => {
  listMembers.mockReset();
  listConnections.mockReset();
  listConnections.mockResolvedValue([]);
});
afterEach(cleanup);

describe('ChannelMap roster states', () => {
  it('does not claim an empty roster while the read is in flight', async () => {
    listMembers.mockReturnValue(new Promise(() => {}));
    await mount();
    expect(screen.queryByText('monitor.map_empty')).not.toBeInTheDocument();
  });

  it('says the read failed rather than that the team has no members', async () => {
    listMembers.mockRejectedValue({ error: 'database is locked', kind: 'Database' });
    await mount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText('monitor.map_empty')).not.toBeInTheDocument();
    expect(screen.getByText('monitor.dc_hub_peek_failed')).toBeInTheDocument();
  });

  it('shows the empty state once the read answers with no members', async () => {
    listMembers.mockResolvedValue([]);
    await mount();
    expect(await screen.findByText('monitor.map_empty')).toBeInTheDocument();
  });
});
