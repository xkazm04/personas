/**
 * WebhookEventPicker: the draft opens empty, the picker fills it from the
 * known vocabulary, and the preview reports what the chosen patterns would
 * have fired over the recent event log.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { EventVocabularyEntry } from '@/lib/bindings/EventVocabularyEntry';
import { WebhookEventPicker } from '../WebhookEventPicker';

const listEventsInRange = vi.fn();
vi.mock('@/api/overview/events', () => ({
  listEventsInRange: (...args: unknown[]) => listEventsInRange(...args),
}));

const vocabulary: EventVocabularyEntry[] = [
  { eventType: 'execution_completed', category: 'execution', source: 'observed' },
  { eventType: 'execution.finished', category: 'execution', source: 'builtin' },
];

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <WebhookEventPicker value={value} onChange={setValue} vocabulary={vocabulary} />;
}

const event = (id: string, event_type: string, created_at: string) => ({ id, event_type, created_at });

beforeEach(() => {
  listEventsInRange.mockReset();
  listEventsInRange.mockResolvedValue({
    events: [
      event('1', 'execution_completed', '2026-09-22T10:00:00Z'),
      event('2', 'execution_completed', '2026-09-23T10:00:00Z'),
    ],
    has_more: false,
  });
});

describe('WebhookEventPicker', () => {
  it('asks for a pattern when the draft is empty', async () => {
    render(<Harness />);
    await waitFor(() => expect(listEventsInRange).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('webhook-draft-preview')).toBeNull();
  });

  it('picking an observed type previews how often it would have fired', async () => {
    render(<Harness />);
    const chip = await screen.findByRole('button', { name: /execution_completed/ });
    fireEvent.click(chip);
    const preview = await screen.findByTestId('webhook-draft-preview');
    expect(preview.textContent).toContain('2');
    expect(preview.textContent).toContain('execution_completed');
  });

  it('a dotted family over snake_case events says it matches nothing', async () => {
    render(<Harness initial="execution.*" />);
    const preview = await screen.findByTestId('webhook-draft-preview');
    expect(preview.textContent).toContain('execution_completed');
    expect(preview.querySelector('.text-status-success')).toBeNull();
  });
});
