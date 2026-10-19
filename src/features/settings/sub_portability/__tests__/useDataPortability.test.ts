import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { PortabilityImportResult } from '@/lib/bindings/PortabilityImportResult';
import type { CredentialImportResult } from '@/lib/bindings/CredentialImportResult';

const importPortabilityBundle = vi.fn();
const importCredentials = vi.fn();

vi.mock('@/api/system/dataPortability', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getExportStats: vi.fn(async () => null),
  importPortabilityBundle: (...a: unknown[]) => importPortabilityBundle(...a),
  importCredentials: (...a: unknown[]) => importCredentials(...a),
}));

import { useDataPortability } from '../libs/useDataPortability';

function bundleResult(over: Partial<PortabilityImportResult> = {}): PortabilityImportResult {
  return {
    personasCreated: 2, teamsCreated: 0, toolsCreated: 0, credentialsCreated: 0,
    teamMemoriesCreated: 0, kpisCreated: 0, projectsImported: 0, projectsSkipped: 0,
    skillsWritten: 0, skillsDeferred: 0, twinsImported: 0, twinsSkipped: 0,
    twinKbChunksImported: 0, athenaMemoryImported: 0, athenaIdentityReplaced: false,
    reembedQueued: 0, importConflicts: [], bundleFilePath: null, warnings: [], idMapping: {},
    ...over,
  };
}

const CONFLICT = {
  kind: 'project' as const, bundleId: 'b1', name: 'Repo', detail: null,
  existingId: 'local-1', matchedBy: 'root_path',
};

describe('useDataPortability conflict passes', () => {
  beforeEach(() => {
    importPortabilityBundle.mockReset();
    importCredentials.mockReset();
  });

  it('cancelling a workspace conflict pass clears the conflicts the panel renders from', async () => {
    importPortabilityBundle.mockResolvedValue(
      bundleResult({ importConflicts: [CONFLICT], bundleFilePath: 'C:/b.personas' }),
    );
    const { result } = renderHook(() => useDataPortability());
    await act(async () => { await result.current.handleImport(); });
    expect(result.current.importResult?.importConflicts).toHaveLength(1);

    act(() => { result.current.dismissImportConflicts(); });

    expect(result.current.importResult?.importConflicts).toEqual([]);
    expect(result.current.importResult?.bundleFilePath).toBeNull();
    // Pass 1's receipt stays: those rows did land.
    expect(result.current.importResult?.personasCreated).toBe(2);
    expect(result.current.importStatus).toBe('success');
  });

  it('cancelling a credential conflict pass lets the next import start', async () => {
    const conflicted: CredentialImportResult = {
      created: 0, skipped: 0, replaced: 0, warnings: [],
      conflicts: [{ name: 'GitHub', serviceType: 'github', existingId: 'c1' }],
      filePath: 'C:/creds.enc',
    };
    importCredentials.mockResolvedValue(conflicted);
    const { result } = renderHook(() => useDataPortability());
    act(() => { result.current.setCredImportPassphrase('correct horse'); });
    await act(async () => { await result.current.handleCredImport(); });
    expect(result.current.credImportResult?.conflicts).toHaveLength(1);

    act(() => { result.current.dismissCredImportConflicts(); });
    expect(result.current.credImportResult).toBeNull();
    expect(result.current.credImportPassphrase).toBe('');

    importCredentials.mockResolvedValue({ ...conflicted, created: 1, conflicts: [], filePath: null });
    act(() => { result.current.setCredImportPassphrase('correct horse'); });
    await act(async () => { await result.current.handleCredImport(); });
    await waitFor(() => expect(importCredentials).toHaveBeenCalledTimes(2));
    expect(result.current.credImportStatus).toBe('success');
  });
});
