// ProfileSettings — the per-plan sign-in settings dialog: choose or create a
// profile, choose the code inbox and its vault login, the unattended switch.
// Edits are a draft: nothing is written until Save.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { ProfileSettings } from '../ProfileSettings';
import { buildResourceModel } from '../useResourceModel';
import { buildSimAccountsSnapshot, buildSimCliUsage } from '../../simulation/simPlans';
import { profileKeyFromLabel } from '../profileDraft';
import type { ReloginActs } from '../reloginActs';

const NOW = 1_800_000_000_000;

function setup(planId = 'sim-plan-5') {
  const snap = buildSimAccountsSnapshot(NOW);
  const model = buildResourceModel({ accounts: snap, single: null, cli: buildSimCliUsage(NOW), fetchedAt: NOW, now: NOW });
  const plan = model.providers[0]!.plans.find((p) => p.id === planId)!;
  const acts = {
    profiles: snap.profiles,
    relogin: vi.fn(() => Promise.resolve()),
    openSignIn: vi.fn(() => Promise.resolve()),
    saveProfile: vi.fn(() => Promise.resolve()),
    setProfile: vi.fn(() => Promise.resolve()),
    listVaultLogins: vi.fn(() => Promise.resolve([{ id: 'sim-vault-proton', name: 'Proton mailbox' }, { id: 'other', name: 'Other box' }])),
  } satisfies ReloginActs;
  const onClose = vi.fn();
  render(<ProfileSettings plan={plan} acts={acts} onClose={onClose} />);
  return { acts, onClose };
}

const pick = (trigger: HTMLElement, label: string) => {
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: label }));
};

describe('profileKeyFromLabel', () => {
  it.each([
    ['Work Chrome', 'work-chrome'],
    ['  Proton / inbox #2 ', 'proton-inbox-2'],
    ['!!!', ''],
  ])('%j -> %j', (label, key) => {
    expect(profileKeyFromLabel(label)).toBe(key);
  });
});

describe('ProfileSettings', () => {
  it('starts from the plan\'s current link and names the plan', () => {
    setup();
    const dialog = screen.getByTestId('fleet-usage-profile-dialog');
    expect(within(dialog).getByText('Sign-in settings for fleet.five@simulated.test')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Sign-in profile' })).toHaveTextContent('Work Chrome');
    expect(within(dialog).getByTestId('fleet-usage-profile-unattended')).toHaveAttribute('aria-checked', 'false');
  });

  it('saves the draft through the link act, then closes', async () => {
    const { acts, onClose } = setup();
    fireEvent.click(screen.getByTestId('fleet-usage-profile-unattended'));
    fireEvent.click(screen.getByTestId('fleet-usage-profile-save'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(acts.setProfile).toHaveBeenCalledWith('sim-plan-5', 'work-chrome', null, true);
    expect(acts.saveProfile).not.toHaveBeenCalled();
  });

  it('writes nothing on Cancel', () => {
    const { acts, onClose } = setup();
    fireEvent.click(screen.getByTestId('fleet-usage-profile-unattended'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(acts.setProfile).not.toHaveBeenCalled();
  });

  it('creates a profile inline: its key comes from the name, and it is selected', async () => {
    const { acts } = setup();
    pick(screen.getByRole('button', { name: 'Sign-in profile' }), 'New profile');
    const create = screen.getByTestId('fleet-usage-profile-create');
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByTestId('fleet-usage-profile-new-label'), { target: { value: 'Home Chrome' } });
    fireEvent.click(create);
    await waitFor(() => expect(acts.saveProfile).toHaveBeenCalledWith('home-chrome', 'Home Chrome', null));
  });

  it('binds a vault login to the code inbox profile on Save', async () => {
    const { acts, onClose } = setup('sim-plan-7');
    // sim-plan-7 already has the Proton inbox linked and its login bound: change it.
    await waitFor(() => expect(acts.listVaultLogins).toHaveBeenCalled());
    const vault = await screen.findByRole('button', { name: 'Mailbox login for the code inbox' });
    expect(vault).toHaveTextContent('Proton mailbox');
    pick(vault, 'Other box');
    fireEvent.click(screen.getByTestId('fleet-usage-profile-save'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(acts.saveProfile).toHaveBeenCalledWith('proton-inbox', 'Proton inbox', 'other');
    expect(acts.setProfile).toHaveBeenCalledWith('sim-plan-7', 'work-chrome', 'proton-inbox', false);
  });

  it('stays open when saving fails', async () => {
    const { acts, onClose } = setup();
    acts.setProfile.mockRejectedValueOnce(new Error('validation'));
    fireEvent.click(screen.getByTestId('fleet-usage-profile-save'));
    await waitFor(() => expect(acts.setProfile).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });
});
