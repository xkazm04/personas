import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { LabVersionEconomics } from '@/lib/bindings/LabVersionEconomics';
import type { PersonaPromptVersion } from '@/lib/bindings/PersonaPromptVersion';
import { useAgentStore } from '@/stores/agentStore';
import { LabEconomicsPanel } from '../LabEconomicsPanel';

const econ = (versionId: string, costPerSuccess: number): LabVersionEconomics => ({
  versionId,
  modelId: 'haiku',
  provider: 'anthropic',
  attempted: 4,
  resolved: 2,
  resolveRate: 0.5,
  totalCostUsd: costPerSuccess * 2,
  costPerSuccess,
});

const version = (id: string, n: number) => ({ id, version_number: n }) as PersonaPromptVersion;

describe('LabEconomicsPanel', () => {
  beforeEach(() => {
    useAgentStore.setState({
      versionEconomics: [econ('ver-a', 0.01), econ('ver-b', 0.02)],
      promptVersions: [version('ver-a', 3), version('ver-b', 4)],
      fetchVersionEconomics: vi.fn(),
    } as never);
  });

  it('names the version on each (version x model) row, so one model on two versions is two distinguishable rows', () => {
    render(<LabEconomicsPanel personaId="p1" />);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('v3')).toBeTruthy();
    expect(within(rows[1]!).getByText('v4')).toBeTruthy();
  });
});
