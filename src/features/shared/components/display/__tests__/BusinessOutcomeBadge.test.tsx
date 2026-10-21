/**
 * The badge's five labels and tooltips were English literals. With a marker
 * catalog (every leaf reads back as its dotted path) a literal passes through
 * unchanged and fails; a catalog key reads back as its path.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/i18n/useTranslation', async () => {
  const en = (await import('@/i18n/locales/en.json')).default as Record<string, unknown>;
  const toMarkers = (node: unknown, path: string): unknown =>
    node && typeof node === 'object'
      ? Object.fromEntries(Object.entries(node).map(([k, v]) => [k, toMarkers(v, path ? `${path}.${k}` : k)]))
      : path;
  const t = toMarkers(en, '');
  return { useTranslation: () => ({ t, tx: (s: unknown) => String(s), language: 'en' }) };
});

import { BusinessOutcomeBadge } from '../BusinessOutcomeBadge';

describe('BusinessOutcomeBadge copy', () => {
  it.each([
    ['value_delivered', 'value_delivered'],
    ['no_input_available', 'no_input_available'],
    ['precondition_failed', 'precondition_failed'],
    ['partial', 'partial'],
    [null, 'unknown'],
    ['not_a_real_outcome', 'unknown'],
  ])('%s reads its label and tooltip from the catalog', (outcome, key) => {
    const { container } = render(<BusinessOutcomeBadge outcome={outcome} variant="compact" />);
    expect(screen.getByText(`shared.business_outcome.${key}_label`)).toBeInTheDocument();
    expect(container.querySelector('span[title]')?.getAttribute('title')).toBe(`shared.business_outcome.${key}_title`);
  });

  it('icon-only variant exposes the localized label as aria-label', () => {
    const { container } = render(<BusinessOutcomeBadge outcome="partial" />);
    expect(container.querySelector('[aria-label]')?.getAttribute('aria-label')).toBe('shared.business_outcome.partial_label');
  });
});
