/**
 * The digest's drill-down: the notification's score and count lead to the
 * agents that need attention and their issues, each row opening its agent.
 * Before 2026-10-30 `healthDigest` had no reader at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import en from '@/i18n/locales/en.json';

vi.mock('@/i18n/useTranslation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n/useTranslation')>();
  return {
    ...actual,
    useTranslation: () => ({ t: en, tx: actual.interpolate, language: 'en' }),
  };
});

import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { HealthDigestPanel } from './HealthDigestPanel';
import type { AgentHealthDigest, PersonaHealthCheck } from './types';

function check(id: string, name: string, status: 'ready' | 'partial' | 'blocked', issues: Array<[PersonaHealthCheck['result']['issues'][number]['severity'], string]>): PersonaHealthCheck {
  return {
    personaId: id, personaName: name, personaIcon: null, personaColor: null, checkedAt: '2026-10-30T09:00:00Z',
    result: { status, issues: issues.map(([severity, description], i) => ({ id: `${id}-${i}`, severity, description })) },
  };
}

const digest: AgentHealthDigest = {
  generatedAt: '2026-10-30T09:00:00Z',
  personas: [
    check('g', 'Gamma', 'ready', [['info', 'No telemetry yet']]),
    check('b', 'Beta', 'partial', [['warning', 'Budget at 90%']]),
    check('a', 'Alpha', 'blocked', [['error', 'Circuit breaker tripped 2 time(s)'], ['warning', 'Success rate is 60%']]),
  ],
  totalScore: { value: 74, grade: 'degraded' },
  totalIssues: 3, errorCount: 1, warningCount: 2, infoCount: 1, undeterminedCount: 0,
};

const selectPersona = vi.fn();
const setSidebarSection = vi.fn();

beforeEach(() => {
  selectPersona.mockReset();
  setSidebarSection.mockReset();
  useAgentStore.setState({ healthDigest: digest, healthDigestRunning: false, selectPersona } as never);
  useSystemStore.setState({ setSidebarSection } as never);
});

describe('HealthDigestPanel', () => {
  it('leads from the summary to the failing agents, worst first, with their issues', () => {
    render(<HealthDigestPanel />);
    expect(screen.getByTestId('health-digest-summary').textContent).toBe('Score 74/100 · 3 issues · 3 agents checked');

    const rows = screen.getAllByTestId(/^health-digest-row-/).map((r) => r.getAttribute('data-testid'));
    expect(rows).toEqual(['health-digest-row-a', 'health-digest-row-b']);

    const alpha = screen.getByTestId('health-digest-row-a');
    expect(within(alpha).getByText('Circuit breaker tripped 2 time(s) (+1 more)')).toBeTruthy();
    expect(within(screen.getByTestId('health-digest-row-b')).getByText('Budget at 90%')).toBeTruthy();
    expect(screen.queryByText('Gamma')).toBeNull();
  });

  it('opens the agent a row names', () => {
    render(<HealthDigestPanel />);
    fireEvent.click(within(screen.getByTestId('health-digest-row-a')).getByRole('button', { name: 'Alpha' }));
    expect(setSidebarSection).toHaveBeenCalledWith('personas');
    expect(selectPersona).toHaveBeenCalledWith('a');
  });

  it('says so when every agent is healthy', () => {
    useAgentStore.setState({ healthDigest: { ...digest, personas: [digest.personas[0]!], totalIssues: 0 } } as never);
    render(<HealthDigestPanel />);
    expect(screen.getByText(en.agents.health_digest.all_healthy)).toBeTruthy();
  });

  it('offers to run a digest when none has run this session', () => {
    const run = vi.fn().mockResolvedValue(null);
    useAgentStore.setState({ healthDigest: null, runFullHealthDigest: run } as never);
    render(<HealthDigestPanel />);
    expect(screen.getByTestId('health-digest-summary').textContent).toBe(en.agents.health_digest.panel_never_run);
    fireEvent.click(screen.getByTestId('health-digest-run'));
    expect(run).toHaveBeenCalledTimes(1);
  });
});
