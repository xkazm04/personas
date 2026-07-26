// Memory section for the project sidebar — the visible end of the Project
// Memory Ledger (docs/plans/skill-memory-unification.md P2/P3): context
// coverage within the 30d freshness window, plus the two Obsidian vault
// actions when the Brain plugin has a vault configured (P3 — hidden
// otherwise; the vault is an optional projection, never a requirement).
import { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, BrainCircuit } from 'lucide-react';

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
    <div className="px-4 py-3 border-t border-primary/10" data-testid="mm-memory-section">
      <div className="flex items-center gap-1.5 mb-1.5">
        <BrainCircuit className="w-3.5 h-3.5 text-primary/70" aria-hidden />
        <span className="typo-label text-foreground/90">{t.mastermind.memory_title}</span>
      </div>
      {coverage === null ? null : !hasMemory ? (
        <p className="typo-caption text-foreground/45 leading-snug" style={{ fontWeight: 400 }}>{t.mastermind.memory_empty}</p>
      ) : (
        <div className="space-y-0.5">
          <p className="typo-caption text-foreground/70 tabular-nums">
            {tx(t.mastermind.memory_coverage, { covered: coverage.covered, contexts: coverage.contexts, days: coverage.windowDays })}
          </p>
          {coverage.unanchored > 0 && (
            <p className="typo-caption text-foreground/45 tabular-nums">{tx(t.mastermind.memory_unanchored, { n: coverage.unanchored })}</p>
          )}
        </div>
      )}
      {vault && (
        <div className="flex items-center gap-1.5 mt-2">
          <button
            type="button"
            onClick={sync}
            disabled={busy}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive typo-label text-foreground/60 hover:text-foreground hover:bg-primary/10 border border-primary/15 transition-colors disabled:opacity-50"
            data-testid="mm-memory-sync-vault"
          >
            <ArrowUpFromLine className="w-3 h-3" aria-hidden />
            {t.mastermind.memory_sync_vault}
          </button>
          <button
            type="button"
            onClick={importVault}
            disabled={busy}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive typo-label text-foreground/60 hover:text-foreground hover:bg-primary/10 border border-primary/15 transition-colors disabled:opacity-50"
            data-testid="mm-memory-import-vault"
          >
            <ArrowDownToLine className="w-3 h-3" aria-hidden />
            {t.mastermind.memory_import_vault}
          </button>
        </div>
      )}
    </div>
  );
}
