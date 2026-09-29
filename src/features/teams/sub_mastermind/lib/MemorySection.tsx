// Memory block of the Soundings project file — the visible end of the Project
// Memory Ledger (docs/plans/skill-memory-unification.md P2/P3): context
// coverage within the 30d freshness window, plus the two Obsidian vault
// actions when the Brain plugin has a vault configured (P3 — hidden
// otherwise; the vault is an optional projection, never a requirement).
// "Import from vault" has no other door in the app.
import { useEffect, useState } from 'react';

import { importMemoryFromVault, memoryCoverage, projectMemoryToVault, type MemoryCoverage } from '@/api/devTools/devTools';
import { obsidianBrainGetConfig } from '@/api/obsidianBrain';
import { silentCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';

export function MemorySection({ projectId }: { projectId: string }) {
  const { t, tx } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [coverage, setCoverage] = useState<MemoryCoverage | null>(null);
  const [vault, setVault] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    memoryCoverage(projectId)
      .then((c) => { if (alive) setCoverage(c); })
      .catch(silentCatch('memory section coverage'));
    obsidianBrainGetConfig()
      .then((cfg) => { if (alive) setVault(Boolean(cfg?.vaultPath?.trim())); })
      .catch(silentCatch('memory section vault config'));
    return () => { alive = false; };
  }, [projectId]);

  const sync = async () => {
    setBusy(true);
    try {
      const r = await projectMemoryToVault(projectId);
      if (r.vaultConfigured) addToast(tx(t.mastermind.memory_vault_synced, { n: r.written }), 'success');
    } catch (e) {
      silentCatch('memory vault sync')(e);
    } finally {
      setBusy(false);
    }
  };

  const importVault = async () => {
    setBusy(true);
    try {
      const r = await importMemoryFromVault(projectId);
      if (r.vaultConfigured) {
        addToast(tx(t.mastermind.memory_vault_imported, { imported: r.imported, updated: r.updated }), 'success');
        void memoryCoverage(projectId).then(setCoverage).catch(silentCatch('memory coverage refresh'));
      }
    } catch (e) {
      silentCatch('memory vault import')(e);
    } finally {
      setBusy(false);
    }
  };

  const hasMemory = coverage !== null && (coverage.covered > 0 || coverage.unanchored > 0);

  return (
    <div className="sd-d-mem" data-testid="mm-memory-section">
      <span className="sd-c-lab typo-label">{t.mastermind.memory_title}</span>
      {coverage === null ? null : !hasMemory ? (
        <div className="sd-muted">{t.mastermind.memory_empty}</div>
      ) : (
        <>
          <div className="typo-data">
            {tx(t.mastermind.memory_coverage, { covered: coverage.covered, contexts: coverage.contexts, days: coverage.windowDays })}
          </div>
          {coverage.unanchored > 0 && (
            <div className="sd-muted typo-data">{tx(t.mastermind.memory_unanchored, { n: coverage.unanchored })}</div>
          )}
        </>
      )}
      {vault && (
        <div className="sd-acts">
          <button type="button" className="sd-act" onClick={sync} disabled={busy} data-testid="mm-memory-sync-vault">
            {t.mastermind.memory_sync_vault}
          </button>
          <button type="button" className="sd-act" onClick={importVault} disabled={busy} data-testid="mm-memory-import-vault">
            {t.mastermind.memory_import_vault}
          </button>
        </div>
      )}
    </div>
  );
}
