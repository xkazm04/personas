/**
 * Remove on a gate row drops the origin with its overrides and credential
 * binding, with no undo. It must ask first: the click opens a confirm
 * dialog and only the dialog's confirm calls onRemove.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import WhitelistLedger from '../WhitelistLedger';
import type { BrowserSite } from '../../types';

const SITE: BrowserSite = {
  origin: 'https://app.example.com',
  label: 'App',
  enabled: true,
  overrides: {},
  budget: 50,
  credential_id: null,
  scan_status: 'confirmed',
  scan_tier: 2,
  scan_report: null,
  scan_at: null,
  first_seen: 0,
  last_seen: 0,
  created_by: 'operator',
};

function renderLedger(onRemove: (s: BrowserSite) => Promise<void>) {
  const noop = vi.fn().mockResolvedValue(undefined);
  render(
    <WhitelistLedger
      sites={[SITE]}
      loading={false}
      onToggle={noop}
      onScan={noop}
      onConfirm={noop}
      onRemove={onRemove}
      onOpen={noop}
      onEdit={vi.fn()}
    />,
  );
}

describe('WhitelistLedger remove', () => {
  it('does not remove on the first click, and removes only after confirming', async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    renderLedger(onRemove);

    fireEvent.click(await screen.findByTestId(`whitelist-remove-${SITE.origin}`));
    expect(onRemove).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(SITE.origin)).toBeTruthy();
    fireEvent.click(within(dialog).getAllByRole('button').slice(-1)[0]!);

    await waitFor(() => expect(onRemove).toHaveBeenCalledTimes(1));
    expect(onRemove).toHaveBeenCalledWith(SITE);
  });

  it('cancelling leaves the site alone', async () => {
    const onRemove = vi.fn().mockResolvedValue(undefined);
    renderLedger(onRemove);

    fireEvent.click(await screen.findByTestId(`whitelist-remove-${SITE.origin}`));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getAllByRole('button')[0]!);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onRemove).not.toHaveBeenCalled();
  });
});
