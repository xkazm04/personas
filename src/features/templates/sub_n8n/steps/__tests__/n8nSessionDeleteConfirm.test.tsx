/**
 * DW-255. Deleting a saved import has to be visible to a keyboard user and asked
 * for first. The real list, row and confirm are mounted; only the API is stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/useTranslation')>()),
  useTranslation: () => ({ t: en, tx: (s: string) => s, language: 'en' }),
}));

const api = vi.hoisted(() => ({
  listN8nSessionSummaries: vi.fn(),
  deleteN8nSession: vi.fn(),
  getN8nSession: vi.fn(),
}));
vi.mock('@/api/templates/n8nTransform', () => api);

import { N8nSessionList } from '../N8nSessionList';

const NAME = 'Invoice workflow';
const SUMMARY = {
  id: 's1',
  workflow_name: NAME,
  status: 'draft',
  step: 'upload',
  error: null,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};
const FULL = {
  ...SUMMARY,
  raw_workflow_json: '{}',
  parser_result: null,
  draft_json: null,
  questions_json: null,
  user_answers: null,
  transform_id: null,
};

const DELETE_LABEL = en.templates.n8n.delete_session;
const CANNOT_UNDO = en.common.confirm_destructive_cannot_undo;

async function renderList() {
  render(<N8nSessionList onLoadSession={() => {}} />);
  await screen.findByText(NAME);
}

const deleteButton = () => screen.getByRole('button', { name: DELETE_LABEL });
const row = () => screen.getByTestId('n8n-session-card-s1');

const confirmDialog = () =>
  screen.queryByText(CANNOT_UNDO)?.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]') ?? null;
const shownConfirm = async () => {
  await waitFor(() => expect(confirmDialog()).not.toBeNull());
  return confirmDialog()!;
};
const confirmButton = async () =>
  within(await shownConfirm()).getByRole('button', { name: /delete|confirm/i });
const cancelButton = async () =>
  within(await shownConfirm()).getByRole('button', { name: /cancel/i });

/** Give anything a press set off the time to reach the API. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
  api.listN8nSessionSummaries.mockReset().mockResolvedValue([SUMMARY]);
  api.deleteN8nSession.mockReset().mockResolvedValue(true);
  api.getN8nSession.mockReset().mockResolvedValue(FULL);
});

afterEach(() => {
  cleanup();
});

describe('deleting a saved n8n import', () => {
  it('asks first: the press neither deletes nor loads', async () => {
    await renderList();
    fireEvent.click(deleteButton());
    const dialog = await shownConfirm();
    await settle();

    expect(within(dialog).getByText(DELETE_LABEL)).toBeInTheDocument();
    expect(api.deleteN8nSession).not.toHaveBeenCalled();
    expect(api.getN8nSession).not.toHaveBeenCalled();
  });

  it('cancelling leaves the session and calls nothing', async () => {
    await renderList();
    fireEvent.click(deleteButton());
    fireEvent.click(await cancelButton());

    await waitFor(() => expect(confirmDialog()).toBeNull());
    await settle();
    expect(screen.getByText(NAME)).toBeInTheDocument();
    expect(api.deleteN8nSession).not.toHaveBeenCalled();
    expect(api.getN8nSession).not.toHaveBeenCalled();
  });

  it('confirming deletes once and the row goes', async () => {
    await renderList();
    fireEvent.click(deleteButton());
    fireEvent.click(await confirmButton());

    await waitFor(() => expect(screen.queryByText(NAME)).not.toBeInTheDocument());
    expect(api.deleteN8nSession).toHaveBeenCalledTimes(1);
    expect(api.deleteN8nSession).toHaveBeenCalledWith('s1');
    expect(api.getN8nSession).not.toHaveBeenCalled();
  });

  it('a rejected delete shows the failure and keeps the row', async () => {
    api.deleteN8nSession.mockRejectedValue({ error: 'database is locked', kind: 'internal' });
    await renderList();
    fireEvent.click(deleteButton());
    fireEvent.click(await confirmButton());

    expect(await screen.findByText(en.templates.n8n.failed_to_delete_session)).toBeInTheDocument();
    expect(screen.getByText(NAME)).toBeInTheDocument();
    expect(api.getN8nSession).not.toHaveBeenCalled();
  });
});

// The button sits inside a row that is itself a button. A key press bubbles to the
// row's own keydown handler, so these drive real key presses, not clicks.
describe('deleting with the keyboard', () => {
  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('%s on the delete button asks first and does not load the session', async (_key, press) => {
    const user = userEvent.setup();
    await renderList();
    await user.tab();
    expect(row()).toHaveFocus();
    await user.tab();
    expect(deleteButton()).toHaveFocus();

    await user.keyboard(press);
    await settle();

    expect(api.getN8nSession).not.toHaveBeenCalled();
    expect(api.deleteN8nSession).not.toHaveBeenCalled();
    expect(await shownConfirm()).toBeInTheDocument();
  });

  it('Enter on the confirm deletes once and does not load the session', async () => {
    const user = userEvent.setup();
    await renderList();
    deleteButton().focus();
    await user.keyboard('{Enter}');

    (await confirmButton()).focus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.queryByText(NAME)).not.toBeInTheDocument());
    expect(api.deleteN8nSession).toHaveBeenCalledTimes(1);
    expect(api.getN8nSession).not.toHaveBeenCalled();
  });

  // jsdom computes neither :hover nor :focus-visible from the stylesheet, so this
  // is a check of the class contract only, not of what the button looks like.
  it('reveals the button on keyboard focus (class contract)', async () => {
    await renderList();

    expect(deleteButton()).toHaveClass('opacity-0', 'focus-visible:opacity-100');
  });
});

describe('the row itself', () => {
  it('still loads the session on a click and on Enter', async () => {
    const user = userEvent.setup();
    await renderList();

    fireEvent.click(row());
    await waitFor(() => expect(api.getN8nSession).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(row()).toHaveAttribute('tabindex', '0'));
    row().focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(api.getN8nSession).toHaveBeenCalledTimes(2));
    expect(confirmDialog()).toBeNull();
  });
});
