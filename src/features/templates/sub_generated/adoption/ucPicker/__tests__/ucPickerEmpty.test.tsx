import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const leaf = (prefix: string) => new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` });
const t = new Proxy({}, { get: (_o, section) => leaf(String(section)) });
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s), language: 'en' }),
  getActiveTranslations: () => t,
}));
vi.mock('@/api/overview/events', () => ({ listAllSubscriptions: vi.fn(async () => []) }));
vi.mock('@/stores/vaultStore', () => ({
  useVaultStore: Object.assign(
    (sel: (s: unknown) => unknown) => sel({ credentials: [], fetchCredentials: vi.fn(async () => {}) }),
    { getState: () => ({ credentials: [], fetchCredentials: vi.fn(async () => {}) }) },
  ),
}));

import { UseCasePickerStep } from '../ucPicker';

const FIXTURE_NAMES = [/Weekly Signal Fetcher/, /Congressional Disclosure Scan/, /Sector Gem Discovery/];

function renderPicker(useCases: { id: string; name: string }[] | undefined) {
  const Step = UseCasePickerStep as unknown as (p: Record<string, unknown>) => JSX.Element;
  render(<Step useCases={useCases} onContinue={vi.fn()} />);
}

describe('use-case picker with nothing to pick', () => {
  it('renders no cards and no demo fixtures when the template has no use cases', () => {
    renderPicker([]);
    for (const name of FIXTURE_NAMES) expect(screen.queryByText(name)).toBeNull();
    expect(screen.getByText('empty_states.use_cases_title')).toBeTruthy();
  });

  it('keeps Continue disabled with nothing selectable', () => {
    renderPicker([]);
    expect(screen.getByRole('button', { name: /Continue/ })).toBeDisabled();
  });

  it('substitutes nothing when the parent omits the prop entirely', () => {
    renderPicker(undefined);
    for (const name of FIXTURE_NAMES) expect(screen.queryByText(name)).toBeNull();
    expect(screen.getByRole('button', { name: /Continue/ })).toBeDisabled();
  });

  it('renders exactly the real use cases it was given', () => {
    renderPicker([{ id: 'a', name: 'Triage inbox' }, { id: 'b', name: 'Post digest' }]);
    expect(screen.getByText('Triage inbox')).toBeTruthy();
    expect(screen.getByText('Post digest')).toBeTruthy();
    expect(screen.queryByText('empty_states.use_cases_title')).toBeNull();
    expect(screen.getByRole('button', { name: /Continue/ })).not.toBeDisabled();
  });
});
