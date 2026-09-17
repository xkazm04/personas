import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const COMPARE = {
  title: 'Compare templates',
  subtitle: 'Side-by-side across {count} templates',
  col_category: 'Category',
  col_goal: 'Goal',
  col_complexity: 'Complexity',
  col_setup: 'Setup time',
  col_feasibility: 'Feasibility',
  col_gaps: 'Credential gaps',
  feasibility_ready: 'Ready',
  feasibility_partial: 'Partial',
  feasibility_blocked: 'Blocked',
  gaps_none: 'No gaps',
  none: '-',
  differs: 'Differs',
};
const t = new Proxy({}, {
  get: (_o, section) => section === 'templates'
    ? {
        compare: COMPARE,
        card: { connectors_label: 'Connectors', triggers_label: 'Triggers', use_cases_label: 'Use cases' },
        list: { adoptions: 'Adoptions' },
        complexity: { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced', minuteShort: '{minutes} min' },
        actions: { adopt: 'Adopt', try_it: 'Try it' },
      }
    : new Proxy({}, { get: (_s, k) => `${String(section)}.${String(k)}` }),
});
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t,
    tx: (s: string, vars: Record<string, unknown> = {}) =>
      String(s).replace(/\{(\w+)\}/g, (_m, k) => String(vars[k] ?? '')),
    language: 'en',
  }),
  getActiveTranslations: () => t,
}));

import { CompareModal } from '../CompareModal';

const base = {
  category: 'communication',
  goal: 'Post a digest',
  triggerCount: 1,
  flowCount: 2,
  difficulty: 'beginner' as const,
  setupMinutes: 5,
  adoptionCount: 3,
  hasDesign: true,
};

const columns = [
  { ...base, id: 'a', name: 'Slack digest A', connectors: [{ name: 'slack', ready: true }], feasibility: 'ready' as const, credentialGaps: [] },
  { ...base, id: 'b', name: 'Slack digest B', connectors: [{ name: 'slack', ready: false }], feasibility: 'partial' as const, credentialGaps: ['slack'] },
];

function renderModal(cols: unknown[] = columns) {
  const Modal = CompareModal as unknown as (p: Record<string, unknown>) => JSX.Element;
  render(<Modal isOpen onClose={() => {}} columns={cols} />);
}

describe('compare feasibility and credential gaps', () => {
  it('renders a Feasibility row and a Credential gaps row', () => {
    renderModal();
    expect(screen.getByRole('rowheader', { name: /Feasibility/ })).toBeTruthy();
    expect(screen.getByRole('rowheader', { name: /Credential gaps/ })).toBeTruthy();
  });

  it('shows each column its own verdict', () => {
    renderModal();
    expect(screen.getByText('Ready')).toBeTruthy();
    expect(screen.getByText('Partial')).toBeTruthy();
  });

  it('names the connector that has no ready credential, and says so when none do', () => {
    renderModal();
    expect(screen.getByText('No gaps')).toBeTruthy();
    // The gap cell names the connector; the readiness icon alone never did.
    expect(screen.getAllByText('Slack').length).toBeGreaterThan(0);
  });

  it('flags both rows as differing when the two templates disagree', () => {
    renderModal();
    const feasRow = screen.getByRole('rowheader', { name: /Feasibility/ }).closest('tr');
    const gapsRow = screen.getByRole('rowheader', { name: /Credential gaps/ }).closest('tr');
    expect(feasRow?.className).toContain('bg-amber-500');
    expect(gapsRow?.className).toContain('bg-amber-500');
  });

  it('falls back to the empty marker for a template that was never design-tested', () => {
    renderModal([{ ...columns[0], feasibility: null }, { ...columns[1], feasibility: null }]);
    const feasRow = screen.getByRole('rowheader', { name: /Feasibility/ }).closest('tr');
    expect(feasRow?.textContent).toContain('-');
    expect(screen.queryByText('Ready')).toBeNull();
  });
});
