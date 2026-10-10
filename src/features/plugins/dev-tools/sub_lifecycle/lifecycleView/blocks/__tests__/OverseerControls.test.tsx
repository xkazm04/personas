import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import en from '@/i18n/locales/en.json';

// The Lifecycle header's Overseer control group against a stubbed API: the
// watch toggle reflects what the backend returned; Send opens a confirm that
// reads out the backend's dry run group by group (ghost while it is read, an
// inline line when it fails) and only the confirm sends; a send says what it
// filed inline and a failure says so in a Banner (never a toast); with the
// Overseer off a warning chip links to his setup.

const setLifecycleWatch = vi.hoisted(() => vi.fn());
const sendLifecycleToOverseer = vi.hoisted(() => vi.fn());
const previewLifecycleSend = vi.hoisted(() => vi.fn());
const navigateToCompanions = vi.hoisted(() => vi.fn());
const addToast = vi.hoisted(() => vi.fn());
const overseer = vi.hoisted(() => ({ enabled: true }));

vi.mock('@/api/devTools/lifecycle', () => ({ setLifecycleWatch, sendLifecycleToOverseer, previewLifecycleSend }));
vi.mock('@/features/companions/navigation', () => ({ navigateToCompanions }));
vi.mock('@/features/companions/status/useCompanionsStatus', () => ({
  useCompanionsStatus: () => ({
    byId: (id: string) => (id === 'overseer' ? { id, enabled: overseer.enabled, eligible: true } : null),
  }),
}));
vi.mock('@/stores/toastStore', () => ({
  useToastStore: Object.assign((selector: (s: Record<string, unknown>) => unknown) => selector({ addToast }), {
    getState: () => ({ addToast }),
  }),
}));
// New keys reach the section chunks only after the i18n split runs, so the
// component reads the English catalog directly here.
vi.mock('@/i18n/useTranslation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n/useTranslation')>();
  return { ...actual, useTranslation: () => ({ t: en, tx: actual.interpolate, language: 'en' }) };
});

import { healthyMix } from '../../../journey/__tests__/fixtures';
import { sendPreview, withOverseerGoal } from '../../../journey/__tests__/overseerFixtures';
import { renderLayer1 } from '../../layer1/__tests__/renderLayer1';
import { OverseerControls } from '../OverseerControls';

const dl = en.plugins.dev_lifecycle;

function mount(watched = false, snapshot = withOverseerGoal()) {
  return renderLayer1(<OverseerControls projectId="p1" watched={watched} goal={snapshot.goal} />, snapshot);
}

beforeEach(() => {
  vi.clearAllMocks();
  overseer.enabled = true;
  previewLifecycleSend.mockResolvedValue(sendPreview());
});

describe('OverseerControls: Send with preview', () => {
  it('opens a confirm that reads out every group of the dry run, and sends nothing yet', async () => {
    mount();
    fireEvent.click(screen.getByTestId('lc-overseer-send'));
    expect(previewLifecycleSend).toHaveBeenCalledWith('p1');
    const confirm = screen.getByTestId('lc9-send-confirm');
    // The ghost holds the body while the dry run is read.
    expect(within(confirm).getByTestId('lc9-preview-ghost')).toBeTruthy();

    const body = await within(confirm).findByTestId('lc9-preview');
    const groups = [...body.querySelectorAll('[data-group]')].map((g) => g.getAttribute('data-group'));
    expect(groups).toEqual(['file', 'reopen', 'open', 'decided']);
    expect(body.querySelector('[data-group="file"] h3')!.textContent).toBe('Will file 1 item');
    expect(body.querySelector('[data-group="reopen"] h3')!.textContent).toBe('Will reopen 1 item (regressed)');
    expect(body.querySelector('[data-group="open"] h3')!.textContent).toBe('Already with him: 2');
    expect(body.querySelector('[data-group="decided"] h3')!.textContent).toBe('Left alone: 1');
    expect(within(body).getByTestId('lc9-preview-row-sync').textContent).toContain('Only 3 changes recorded');
    expect(within(body).getByTestId('lc9-preview-row-land').getAttribute('data-health')).toBe('red');
    expect(within(body).getByTestId('lc9-preview-row-commit').textContent).toContain('Item rejected; that decision stands');
    expect(within(body).getByTestId('lc9-preview-healthy').textContent).toContain('5 steps');
    expect(sendLifecycleToOverseer).not.toHaveBeenCalled();
  });

  it('sends on confirm, closes the confirm and says what it filed, inline', async () => {
    sendLifecycleToOverseer.mockResolvedValue({ goalId: 'g1', filed: 3, alreadyOpen: 2 });
    mount();
    fireEvent.click(screen.getByTestId('lc-overseer-send'));
    await screen.findByTestId('lc9-preview');
    fireEvent.click(screen.getByTestId('lc9-send-confirm-go'));

    const line = screen.getByTestId('lc-overseer-result');
    await waitFor(() => expect(line.textContent).toBe('Sent: 3 new items, 2 already open'));
    expect(sendLifecycleToOverseer).toHaveBeenCalledWith('p1');
    expect(screen.queryByTestId('lc9-send-confirm')).toBeNull();
    expect(addToast).not.toHaveBeenCalled();
  });

  it('cancels without sending', async () => {
    mount();
    fireEvent.click(screen.getByTestId('lc-overseer-send'));
    await screen.findByTestId('lc9-preview');
    fireEvent.click(screen.getByText(en.common.cancel));
    expect(screen.queryByTestId('lc9-send-confirm')).toBeNull();
    expect(sendLifecycleToOverseer).not.toHaveBeenCalled();
  });

  it('says a failed dry run inside the confirm, which can still send', async () => {
    previewLifecycleSend.mockRejectedValue(new Error('git exploded'));
    sendLifecycleToOverseer.mockResolvedValue({ goalId: 'g1', filed: 1, alreadyOpen: 0 });
    mount();
    fireEvent.click(screen.getByTestId('lc-overseer-send'));
    expect(await screen.findByTestId('lc9-preview-error')).toBeTruthy();
    fireEvent.click(screen.getByTestId('lc9-send-confirm-go'));
    await waitFor(() => expect(sendLifecycleToOverseer).toHaveBeenCalledWith('p1'));
  });

  it('says when nothing new would be filed, and that a new goal would open', async () => {
    previewLifecycleSend.mockResolvedValue(sendPreview({ goalId: null, willFile: [], willReopen: [] }));
    mount(false, healthyMix({ goal: null }));
    fireEvent.click(screen.getByTestId('lc-overseer-send'));
    const body = await screen.findByTestId('lc9-preview');
    expect(within(body).getByTestId('lc9-preview-nothing').textContent).toBe(dl.lcx9_preview_nothing);
    expect(body.textContent).toContain(dl.lcx9_preview_goal_new);
  });

  it('shows a failed send in an inline Banner, not a toast', async () => {
    sendLifecycleToOverseer.mockRejectedValue(new Error('backend exploded'));
    mount();
    fireEvent.click(screen.getByTestId('lc-overseer-send'));
    await screen.findByTestId('lc9-preview');
    fireEvent.click(screen.getByTestId('lc9-send-confirm-go'));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByTestId('lc-overseer-result').textContent).toBe('');
    expect(addToast).not.toHaveBeenCalled();
  });

  it('offers to send again once a goal exists', () => {
    mount(true);
    expect(screen.getByTestId('lc-overseer-send').textContent).toContain(dl.lc_ov_resend);
  });
});

describe('OverseerControls: watch and the off chip', () => {
  it('watches the project and reflects the state the backend returned', async () => {
    setLifecycleWatch.mockResolvedValue(true);
    mount(false);
    const star = screen.getByTestId('lc-overseer-star');
    expect(star.getAttribute('aria-pressed')).toBe('false');
    expect(star.getAttribute('aria-label')).toBe(dl.lc_ov_watch);
    expect(screen.getByTestId('lc9-watch-word').textContent).toBe(dl.lcx9_watch);

    fireEvent.click(star);

    expect(setLifecycleWatch).toHaveBeenCalledWith('p1', true);
    await waitFor(() => expect(screen.getByTestId('lc-overseer-star').getAttribute('aria-pressed')).toBe('true'));
    expect(screen.getByTestId('lc-overseer-star').getAttribute('aria-label')).toBe(dl.lc_ov_unwatch);
    expect(screen.getByTestId('lc9-watch-word').textContent).toBe(dl.lcx9_watched);
  });

  it('shows a warning chip linking to his setup when the Overseer is off', () => {
    overseer.enabled = false;
    mount(true);
    expect(screen.getByTestId('lc9-overseer-off-chip').textContent).toBe(dl.lcx9_off_chip);
    fireEvent.click(screen.getByTestId('lc9-overseer-setup'));
    expect(navigateToCompanions).toHaveBeenCalledWith('overseer:setup');
  });

  it('shows no chip while the Overseer is on', () => {
    mount(true);
    expect(screen.queryByTestId('lc-overseer-off-hint')).toBeNull();
  });
});
