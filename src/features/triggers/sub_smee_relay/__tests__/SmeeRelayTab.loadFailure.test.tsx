/**
 * A failed read is not "no relays". The failure was only logged, so the tab said
 * no relays are configured and invited adding the first one while relays may
 * still be running: a duplicate on one channel means double events. The failure
 * now shows the rejection's text and a Retry; only a true empty shows the guide.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import enCommon from '@/i18n/section-locales/en/common.json';
import enTriggers from '@/i18n/section-locales/en/triggers.json';

const smeeRelayList = vi.hoisted(() => vi.fn());

vi.mock('@/api/system/cloud', () => ({
  smeeRelayList: (...a: unknown[]) => smeeRelayList(...a),
  smeeRelayCreate: vi.fn(),
  smeeRelaySetStatus: vi.fn(),
  smeeRelayDelete: vi.fn(),
}));
vi.mock('@/api/system/system', () => ({ openExternalUrl: vi.fn() }));
vi.mock('@/hooks/realtime/useSmeeRelayStatus', () => ({
  useSmeeRelayStatus: () => ({ eventsRelayed: 0 }),
}));
vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (selector: (s: unknown) => unknown) => selector({ personas: [] }),
}));

import { SmeeRelayTab } from '../SmeeRelayTab';

// A serialized AppError, the shape an IPC rejection really has.
const REASON = 'Relay table row is unreadable';
const REJECTION = { error: REASON, kind: 'Database' };
const RELAY = {
  id: 'r1', label: 'GitHub staging', channelUrl: 'https://smee.io/abc123', status: 'active',
  eventsRelayed: 0, lastEventAt: null, targetPersonaId: null, eventFilter: null, error: null,
};

const expectNoEmptyClaim = () => {
  expect(screen.queryByText(enTriggers.no_smee_relays)).toBeNull();
  expect(screen.queryByRole('button', { name: enTriggers.add_first_relay })).toBeNull();
  expect(screen.queryByText(enTriggers.how_it_works)).toBeNull();
};
const findBanner = async () => {
  await screen.findByText(REASON);
  return screen.getByRole('alert');
};

describe('SmeeRelayTab failed list read', () => {
  beforeAll(async () => {
    const { preloadSectionsAsync } = await import('@/i18n/useTranslation');
    await preloadSectionsAsync('en', ['triggers']);
  });

  beforeEach(() => {
    smeeRelayList.mockReset();
  });

  it('states the rejection with a Retry, and claims no empty list', async () => {
    smeeRelayList.mockRejectedValue(REJECTION);
    render(<SmeeRelayTab />);

    const banner = await findBanner();
    expect(banner).toHaveTextContent(REASON);
    expect(within(banner).getByRole('button', { name: enCommon.retry })).toBeInTheDocument();
    expectNoEmptyClaim();
  });

  it('Retry re-reads; a success with relays clears the banner and lists them', async () => {
    smeeRelayList.mockRejectedValueOnce(REJECTION);
    render(<SmeeRelayTab />);
    const banner = await findBanner();
    expect(smeeRelayList).toHaveBeenCalledTimes(1);

    smeeRelayList.mockResolvedValueOnce([RELAY]);
    fireEvent.click(within(banner).getByRole('button', { name: enCommon.retry }));

    await waitFor(() => expect(smeeRelayList).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(RELAY.label)).toBeInTheDocument();
    expect(screen.queryByText(REASON)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a Retry that succeeds with no relays ends on the true empty state', async () => {
    smeeRelayList.mockRejectedValueOnce(REJECTION);
    render(<SmeeRelayTab />);
    const banner = await findBanner();

    smeeRelayList.mockResolvedValueOnce([]);
    fireEvent.click(within(banner).getByRole('button', { name: enCommon.retry }));

    expect(await screen.findByText(enTriggers.no_smee_relays)).toBeInTheDocument();
    expect(screen.queryByText(REASON)).toBeNull();
  });

  it('a Retry that fails again keeps the failure stated', async () => {
    smeeRelayList.mockRejectedValue(REJECTION);
    render(<SmeeRelayTab />);
    const banner = await findBanner();

    fireEvent.click(within(banner).getByRole('button', { name: enCommon.retry }));

    await waitFor(() => expect(smeeRelayList).toHaveBeenCalledTimes(2));
    await findBanner();
    expectNoEmptyClaim();
  });

  it('a successful empty read still shows the empty state and the guide, with no banner', async () => {
    smeeRelayList.mockResolvedValue([]);
    render(<SmeeRelayTab />);

    expect(await screen.findByText(enTriggers.no_smee_relays)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: enTriggers.add_first_relay })).toBeInTheDocument();
    expect(screen.getByText(enTriggers.how_it_works)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
