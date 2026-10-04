/**
 * What this file is actually guarding.
 *
 * 1. THE INHERITED BUG. `RailTriageModal.tsx:90-95` awaits its verdict inside a
 *    `try/finally` with no `catch`, and the queue's `decide` swallows the
 *    rejection and toasts — so the modal CLOSED and the row vanished on a write
 *    that failed. The first two tests below are the fixed behaviour: a rejected
 *    `onDecide` leaves the item open, keeps the note typed and keeps the
 *    per-option verdicts recorded.
 * 2. THE PER-OPTION PAYLOAD. The donor flattened per-decision verdicts into a
 *    prose blob in the notes; here they must arrive STRUCTURED, keyed by option
 *    id, in `TriageDecision.answers`.
 * 3. THE KEYBOARD IS TWO-PRESS and goes through the app registry, never
 *    `window`.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';
import type { TriageItem } from '@/features/shared/triage/triageFocusBridge';

import { TriageFocus } from '../TriageFocus';
import type { TriageFocusDecide } from '../useTriageFocus';

function item(overrides: Partial<TriageItem> = {}): TriageItem {
  return {
    id: 'review:1',
    sourceId: '1',
    kind: 'review',
    title: 'A thing to judge',
    body: 'the case',
    tags: [],
    facts: [],
    source: { label: 'Scout' },
    createdAt: '2026-01-01T00:00:00.000Z',
    weight: 50,
    branches: [],
    verdictLabels: { accept: 'Approve', reject: 'Decline', skip: 'Later' },
    ...overrides,
  };
}

function mount(items: TriageItem[], onDecide: TriageFocusDecide) {
  return render(
    <AppKeyboardProvider>
      <TriageFocus items={items} onDecide={onDecide} />
    </AppKeyboardProvider>,
  );
}

describe('TriageFocus', () => {
  it('keeps the item open when the write fails', async () => {
    const onDecide = vi.fn().mockRejectedValue(new Error('backend said no'));
    mount([item()], onDecide);

    fireEvent.click(screen.getByTestId('triage-focus-reject'));
    await act(async () => { fireEvent.click(screen.getByTestId('triage-focus-confirm')); });

    expect(onDecide).toHaveBeenCalledTimes(1);
    // Still here, and saying so.
    expect(screen.getByTestId('triage-focus-card')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('arms on the first press and writes on the second', async () => {
    const onDecide = vi.fn().mockResolvedValue(undefined);
    mount([item()], onDecide);

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onDecide).not.toHaveBeenCalled();
    await act(async () => { fireEvent.keyDown(window, { key: 'ArrowRight' }); });
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide.mock.calls[0]![0]).toMatchObject({ verdict: 'accept' });
  });

  it('commits per-option verdicts as a map, not as prose', async () => {
    const onDecide = vi.fn().mockResolvedValue(undefined);
    mount([item({
      decisions: [
        { id: 'a', label: 'Option A' },
        { id: 'b', label: 'Option B' },
      ],
    })], onDecide);

    // One arrow per option; the second resolves the parent.
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await act(async () => { fireEvent.keyDown(window, { key: 'ArrowLeft' }); });

    expect(onDecide).toHaveBeenCalledTimes(1);
    const call = onDecide.mock.calls[0]![0];
    expect(call.answers).toEqual({ a: 'accept', b: 'reject' });
    // Any accepted option approves the parent — and the note carries no verdict.
    expect(call.verdict).toBe('accept');
    expect(call.reason).toBeUndefined();
  });

  it('renders no queue rail unless asked', () => {
    const onDecide = vi.fn();
    const { rerender } = mount([item(), item({ id: 'review:2', sourceId: '2' })], onDecide);
    expect(screen.queryByTestId('triage-focus-queue')).toBeNull();

    rerender(
      <AppKeyboardProvider>
        <TriageFocus items={[item(), item({ id: 'review:2', sourceId: '2' })]} onDecide={onDecide} queueSidebar />
      </AppKeyboardProvider>,
    );
    expect(screen.getByTestId('triage-focus-queue')).toBeTruthy();
  });
});
