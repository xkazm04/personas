import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { CredentialPortability } from '../components/CredentialPortability';
import type { CredentialImportResult } from '@/lib/bindings/CredentialImportResult';

function renderPanel(result: CredentialImportResult | null, onCredDismissConflicts = vi.fn()) {
  render(
    <CredentialPortability
      credExportStatus="idle"
      credImportStatus="idle"
      credImportResult={result}
      credExportPassphrase=""
      setCredExportPassphrase={vi.fn()}
      credImportPassphrase=""
      setCredImportPassphrase={vi.fn()}
      showCredExportInput={false}
      setShowCredExportInput={vi.fn()}
      showCredImportInput={false}
      setShowCredImportInput={vi.fn()}
      onCredExport={vi.fn()}
      onCredImport={vi.fn()}
      onCredImportWithResolutions={vi.fn()}
      onCredDismissConflicts={onCredDismissConflicts}
    />,
  );
  return onCredDismissConflicts;
}

const base: CredentialImportResult = {
  created: 0, skipped: 0, replaced: 0, warnings: [], conflicts: [], filePath: null,
};

describe('CredentialPortability', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['settings']);
  });

  it('shows a receipt for a resolution pass that skipped every conflict', () => {
    renderPanel({ ...base, skipped: 2 });
    expect(screen.getByText(/2 skipped/)).toBeInTheDocument();
  });

  it('shows the import warnings even when nothing was created', () => {
    renderPanel({ ...base, warnings: ['GitHub: field token dropped'] });
    expect(screen.getByText(/GitHub: field token dropped/)).toBeInTheDocument();
  });

  it('offers a way out of the conflict pass', () => {
    const onDismiss = renderPanel({
      ...base,
      conflicts: [{ name: 'GitHub', serviceType: 'github', existingId: 'c1' }],
      filePath: 'C:/creds.enc',
    });
    fireEvent.click(screen.getByTestId('portability-cred-conflict-cancel'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
