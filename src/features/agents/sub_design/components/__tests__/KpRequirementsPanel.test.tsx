import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

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

import { KpRequirementsPanel } from '../KpRequirementsPanel';

const designContext = JSON.stringify({
  kpLink: {
    jobId: 'gig-1',
    jobTitle: 't',
    baseUrl: 'http://x',
    reportToken: 'tok',
    requirements: {
      kind: 'kp.agent-requirements.v1',
      role: 'Freelance specialist - web development',
      purpose: 'Deliver small web gigs end to end.',
      responsibilities: ['Read the brief and restate the ask'],
      outputs: { handoffFile: 'kp-deliverable.json', reviewChecklist: ['brief_answered'] },
      constraints: ['Never send anything; the operator sends.', 'Disclose AI assistance in what goes out.'],
      tools: [{ connector: 'research', why: 'check vendor facts' }],
    },
  },
});

describe('KpRequirementsPanel', () => {
  it('renders nothing for a persona without kp requirements', () => {
    const { container } = render(<KpRequirementsPanel designContext={'{"kpLink":{"jobId":"j"}}'} />);
    expect(container.firstChild).toBeNull();
    const none = render(<KpRequirementsPanel designContext={null} />);
    expect(none.container.firstChild).toBeNull();
  });

  it('always shows the purpose and every MUST constraint', () => {
    render(<KpRequirementsPanel designContext={designContext} />);
    expect(screen.getByTestId('kp-requirements-panel')).toBeTruthy();
    expect(screen.getByText('kp_requirements.title')).toBeTruthy();
    expect(screen.getByText('Deliver small web gigs end to end.')).toBeTruthy();
    const list = screen.getByTestId('kp-requirements-constraints');
    expect(list.querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByText('Never send anything; the operator sends.')).toBeTruthy();
    // The long tail stays behind the disclosure until asked for.
    expect(screen.queryByText('Read the brief and restate the ask')).toBeNull();
  });

  it('opens the full brief behind one disclosure', () => {
    render(<KpRequirementsPanel designContext={designContext} />);
    const toggle = screen.getByTestId('kp-requirements-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(screen.getByTestId('kp-requirements-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Read the brief and restate the ask')).toBeTruthy();
    expect(screen.getByText('kp-deliverable.json')).toBeTruthy();
    expect(screen.getByText('research')).toBeTruthy();
    expect(screen.getByText('check vendor facts')).toBeTruthy();
  });
});
