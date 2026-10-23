import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Czech over English, the way the runtime `t` proxy merges a locale section.
import en from '@/i18n/locales/en.json';
import cs from '@/i18n/locales/cs.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: { ...en, explore: { ...en.explore, ...cs.explore } },
    tx: (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k])),
  }),
}));

import { DomainTable } from '../level2/DomainTable';
import { DomainLevel2 } from '../level2/DomainLevel2';

describe('Explore level 2 chrome follows the UI language', () => {
  it('renders the table chrome in Czech, not English', () => {
    render(<DomainTable templates={[]} recipes={[]} accent="#000" />);
    expect(screen.getByPlaceholderText(cs.explore.l2_filter_placeholder)).toBeTruthy();
    expect(screen.getByRole('button', { name: cs.explore.l2_col_name })).toBeTruthy();
    expect(screen.getByText(cs.explore.l2_no_matches)).toBeTruthy();
    expect(screen.queryByText('No matches.')).toBeNull();
    expect(screen.queryByPlaceholderText('Filter by name…')).toBeNull();
  });

  it('renders the header back control and counts in Czech', () => {
    render(<DomainLevel2 domainId="operations" onBack={() => {}} />);
    expect(screen.getByText(cs.explore.l2_all_domains)).toBeTruthy();
    expect(screen.queryByText('All domains')).toBeNull();
  });
});
