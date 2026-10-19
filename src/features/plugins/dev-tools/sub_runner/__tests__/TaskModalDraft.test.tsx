import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { TaskModal } from '../TaskModal';

// The New Task modal used to clear its fields and close BEFORE the create
// settled, so a failed create (the page toasts it) threw the typed draft away.

beforeAll(async () => {
  await preloadSectionsAsync('en', ['plugins']);
});

function fill(title: string) {
  const [titleInput] = screen.getAllByRole('textbox');
  fireEvent.change(titleInput!, { target: { value: title } });
  return titleInput as HTMLInputElement;
}

function submitButton() {
  return screen.getByRole('button', { name: /create task/i });
}

describe('TaskModal draft', () => {
  it('keeps the draft and stays open when the create fails', async () => {
    const onClose = vi.fn();
    const onCreate = vi.fn(async () => {
      throw { error: 'database is locked', kind: 'database' };
    });
    render(<TaskModal open onClose={onClose} onCreate={onCreate} />);

    const input = fill('Fix the flaky login test');
    fireEvent.click(submitButton());

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(submitButton()).not.toHaveAttribute('aria-busy', 'true'));
    expect(onClose).not.toHaveBeenCalled();
    expect(input.value).toBe('Fix the flaky login test');
  });

  it('clears and closes once the create succeeds', async () => {
    const onClose = vi.fn();
    const onCreate = vi.fn(async () => ({ id: 't1' }));
    render(<TaskModal open onClose={onClose} onCreate={onCreate} />);

    fill('Ship it');
    fireEvent.click(submitButton());

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0]![0]).toMatchObject({ title: 'Ship it', depth: 'quick' });
  });
});
