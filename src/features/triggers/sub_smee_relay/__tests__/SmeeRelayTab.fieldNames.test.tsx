/**
 * WCAG 2.2 1.3.1 and 4.1.2. The add-relay labels were not tied to their inputs,
 * so assistive tech read only the placeholder, and the validation messages were
 * not linked to the field they are about.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import enTriggers from '@/i18n/section-locales/en/triggers.json';

vi.mock('@/api/system/cloud', () => ({
  smeeRelayList: vi.fn(async () => []),
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

const openForm = async () => {
  render(<SmeeRelayTab />);
  fireEvent.click(await screen.findByRole('button', { name: enTriggers.add_relay }));
};

/** The placeholder is not a name here: it is what the fields already had. */
const hasProgrammaticName = (el: HTMLInputElement | HTMLSelectElement) =>
  (el.labels?.length ?? 0) > 0 || !!el.getAttribute('aria-label') || !!el.getAttribute('aria-labelledby');

describe('SmeeRelayTab add-relay fields', () => {
  beforeAll(async () => {
    const { preloadSectionsAsync } = await import('@/i18n/useTranslation');
    await preloadSectionsAsync('en', ['triggers']);
  });

  beforeEach(() => { vi.clearAllMocks(); });

  it('the label and URL fields are found by their visible labels', async () => {
    await openForm();
    expect(screen.getByLabelText(enTriggers.relay_label_field).tagName).toBe('INPUT');
    expect(screen.getByLabelText(enTriggers.relay_channel_url_field).tagName).toBe('INPUT');
    expect(screen.getByLabelText(enTriggers.relay_label_field))
      .toHaveAttribute('placeholder', enTriggers.relay_label_placeholder);
    expect(screen.getByLabelText(enTriggers.relay_channel_url_field))
      .toHaveAttribute('placeholder', enTriggers.relay_channel_url_placeholder);
  });

  it('every field of the form has a programmatic name', async () => {
    await openForm();
    const form = screen.getByLabelText(enTriggers.relay_label_field).closest('.grid')!;
    const fields = [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')];
    expect(fields).toHaveLength(4);
    expect(fields.filter((f) => !hasProgrammaticName(f)).map((f) => f.getAttribute('placeholder') ?? f.tagName)).toEqual([]);
  });

  it('an empty label on blur is marked invalid and its message is linked', async () => {
    await openForm();
    const field = screen.getByLabelText(enTriggers.relay_label_field);
    expect(field).not.toHaveAttribute('aria-invalid', 'true');

    fireEvent.blur(field);

    const message = await screen.findByText(enTriggers.relay_err_label_required);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription(expect.stringContaining(message.textContent!.trim()));

    fireEvent.change(field, { target: { value: 'GitHub staging' } });
    await waitFor(() => expect(screen.queryByText(enTriggers.relay_err_label_required)).toBeNull());
    expect(field).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('a bad URL on blur is marked invalid and its message is linked', async () => {
    await openForm();
    const field = screen.getByLabelText(enTriggers.relay_channel_url_field);
    fireEvent.change(field, { target: { value: 'http://example.com' } });
    fireEvent.blur(field);

    const message = await screen.findByText(enTriggers.relay_err_url_prefix);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription(expect.stringContaining(message.textContent!.trim()));

    fireEvent.change(field, { target: { value: 'https://smee.io/abc123' } });
    await waitFor(() => expect(screen.queryByText(enTriggers.relay_err_url_prefix)).toBeNull());
    expect(field).not.toHaveAttribute('aria-invalid', 'true');
  });
});
