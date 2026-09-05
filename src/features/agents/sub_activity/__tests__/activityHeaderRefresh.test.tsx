import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const leaf = (prefix: string) => new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` });
const t = new Proxy({}, {
  get: (_o, section) => section === 'agents'
    ? new Proxy({}, { get: (_s, sub) => leaf(String(sub)) })
    : leaf(String(section)),
});
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s), language: 'en' }),
  getActiveTranslations: () => t,
}));
vi.mock('@/api/agents/executions', () => ({ listActiveChains: vi.fn(async () => []) }));

import { ActivityHeader } from '../ActivityHeader';

describe('activity header refresh control', () => {
  it('is named and reports busy while the feed reloads', () => {
    render(<ActivityHeader personaId="p1" itemCount={3} isLoading onRefresh={() => {}} />);
    // Icon-only: the name must come from aria-label, and the spinning glyph
    // alone told assistive tech nothing about the reload in flight.
    const btn = screen.getByRole('button', { name: 'common.refresh' });
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  it('drops the busy flag once the feed has settled', () => {
    render(<ActivityHeader personaId="p1" itemCount={3} isLoading={false} onRefresh={() => {}} />);
    expect(screen.getByRole('button', { name: 'common.refresh' })).not.toHaveAttribute('aria-busy');
  });
});
