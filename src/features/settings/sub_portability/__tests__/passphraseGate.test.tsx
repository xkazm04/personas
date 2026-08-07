import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ManifestCart } from '../components/export-prototype/ManifestCart';
import type { ExportInventory, ExportKind, ExportPicker } from '../components/export-prototype/types';

const EMPTY_INV: ExportInventory = {
  loading: false,
  personas: [],
  teams: [],
  credentials: [],
  projects: [],
  workspaces: [],
  twins: [],
  athenaTiers: [],
  twinFactCount: new Map(),
  personaTeams: new Map(),
  teamMemberCount: new Map(),
  teamKpiCount: new Map(),
  teamOffTrackCount: new Map(),
  eligibleKpiCount: 0,
  kpiIdsForTeams: () => [],
};

const ZERO = { selected: 0, total: 0 };

function makePicker(over: Partial<ExportPicker> = {}): ExportPicker {
  const counts: Record<ExportKind, { selected: number; total: number }> = {
    personas: ZERO,
    teams: ZERO,
    credentials: ZERO,
    projects: ZERO,
    knowledge: ZERO,
    twins: { selected: 1, total: 1 },
    athena: ZERO,
  };
  return {
    inv: EMPTY_INV,
    selectedPersonas: new Set(),
    selectedTeams: new Set(),
    selectedCredentials: new Set(),
    selectedProjects: new Set(),
    selectedWorkspaces: new Set(),
    selectedTwins: new Set(['twin-a']),
    selectedAthenaTiers: new Set(),
    includeKpiSetup: false,
    includeMemories: true,
    passphrase: '',
    isSelected: () => false,
    toggle: vi.fn(),
    setMany: vi.fn(),
    setIncludeKpiSetup: vi.fn(),
    setIncludeMemories: vi.fn(),
    setPassphrase: vi.fn(),
    allIds: { personas: [], teams: [], credentials: [], projects: [], knowledge: [], twins: ['twin-a'], athena: [] },
    counts,
    kpiShipCount: 0,
    totalSelected: 1,
    totalItems: 1,
    isFullExport: true,
    passphraseValid: true,
    passphraseRequired: true,
    passphraseMissing: true,
    commit: vi.fn(),
    ...over,
  };
}

describe('passphrase gate', () => {
  it('shows the gate and disables export when an encrypted scope is selected with no passphrase', () => {
    render(<ManifestCart picker={makePicker()} exporting={false} onCancel={vi.fn()} />);
    expect(screen.getByTestId('portability-passphrase-gate')).toBeInTheDocument();
    expect(screen.getByTestId('export-confirm-button')).toBeDisabled();
  });

  it('clears the gate and enables export once a valid passphrase is entered', () => {
    render(
      <ManifestCart
        picker={makePicker({ passphrase: 'long-enough-passphrase', passphraseMissing: false })}
        exporting={false}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('portability-passphrase-gate')).not.toBeInTheDocument();
    expect(screen.getByTestId('export-confirm-button')).toBeEnabled();
  });

  it('does not gate an export that touches no encrypted scope', () => {
    const picker = makePicker({
      selectedTwins: new Set(),
      counts: {
        personas: { selected: 2, total: 2 },
        teams: ZERO,
        credentials: ZERO,
        projects: ZERO,
        knowledge: ZERO,
        twins: { selected: 0, total: 1 },
        athena: ZERO,
      },
      totalSelected: 2,
      totalItems: 3,
      isFullExport: false,
      passphraseRequired: false,
      passphraseMissing: false,
    });
    render(<ManifestCart picker={picker} exporting={false} onCancel={vi.fn()} />);
    expect(screen.queryByTestId('portability-passphrase-gate')).not.toBeInTheDocument();
    expect(screen.getByTestId('export-confirm-button')).toBeEnabled();
  });
});
