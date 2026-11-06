/**
 * WCAG 2.2 1.3.1 and 4.1.2. The payload label had no `htmlFor` and the textarea
 * had no id or aria-label, so a screen reader announced the box with no name. Its
 * validation hint was not linked to it either.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import enTriggers from '@/i18n/section-locales/en/triggers.json';

vi.mock('@/api/overview/events', () => ({
  listKnownEventTypes: vi.fn(async () => []),
  listEvents: vi.fn(async () => []),
  listAllSubscriptions: vi.fn(async () => []),
  testEventFlow: vi.fn(),
}));
vi.mock('@/api/pipeline/triggers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/pipeline/triggers')>()),
  listAllTriggers: vi.fn(async () => []),
}));

import { TestTab } from '../TestTab';
import { useAgentStore } from '@/stores/agentStore';

describe('TestTab payload field', () => {
  beforeAll(async () => {
    const { preloadSectionsAsync } = await import('@/i18n/useTranslation');
    await preloadSectionsAsync('en', ['triggers']);
  });

  beforeEach(() => {
    useAgentStore.setState({ personas: [{ id: 'p1', name: 'Closer' }] as never });
  });

  it('has a programmatic name from its visible label', () => {
    render(<TestTab />);
    expect(screen.getByLabelText(enTriggers.payload_json_label).tagName).toBe('TEXTAREA');
  });

  it('a valid payload is not marked invalid', () => {
    render(<TestTab />);
    expect(screen.getByLabelText(enTriggers.payload_json_label)).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('invalid JSON marks the field invalid and links the message to it', async () => {
    render(<TestTab />);
    const field = screen.getByLabelText(enTriggers.payload_json_label);
    fireEvent.change(field, { target: { value: '{ not json' } });

    const message = await screen.findByText(enTriggers.test_payload_invalid_json);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription(expect.stringContaining(message.textContent!));

    fireEvent.change(field, { target: { value: '{}' } });
    await waitFor(() => expect(screen.queryByText(enTriggers.test_payload_invalid_json)).toBeNull());
    expect(field).not.toHaveAttribute('aria-invalid', 'true');
  });
});
