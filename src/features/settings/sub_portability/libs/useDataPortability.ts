import { silentCatch } from "@/lib/silentCatch";
import { useState, useEffect, useCallback } from 'react';
import {
  getExportStats,
  exportFull,
  exportSelective,
  importPortabilityBundle,
  exportCredentials,
  importCredentials,
} from '@/api/system/dataPortability';
import { errMsg } from '@/stores/storeTypes';
import { useTranslation } from '@/i18n/useTranslation';
import { createTtlValueCache } from '@/lib/async/createTtlValueCache';
import type {
  ExportStats,
  ExportSelectionArgs,
  PortabilityImportResult,
  CredentialImportResult,
} from '@/api/system/dataPortability';

type Status = 'idle' | 'loading' | 'success' | 'error';

/** Export stats change rarely (only on import). Cache the value at module
 *  scope so re-visiting the Portability tab seeds from cache instead of
 *  re-issuing the IPC on every mount. Invalidated after a successful import. */
const STATS_KEY = 'stats';
const exportStatsCache = createTtlValueCache<ExportStats>(60_000);

/** Backend counters are per-invocation (pass 2 only reports what IT created),
 *  so the visible result card sums both passes. Conflicts are cleared — the
 *  resolution pass consumed them — and the second pass's id_mapping wins on
 *  key collisions (there are none in practice; passes cover disjoint rows). */
function mergeImportResults(
  first: PortabilityImportResult,
  second: PortabilityImportResult,
): PortabilityImportResult {
  return {
    ...second,
    personasCreated: first.personasCreated + second.personasCreated,
    teamsCreated: first.teamsCreated + second.teamsCreated,
    toolsCreated: first.toolsCreated + second.toolsCreated,
    credentialsCreated: first.credentialsCreated + second.credentialsCreated,
    teamMemoriesCreated: first.teamMemoriesCreated + second.teamMemoriesCreated,
    kpisCreated: first.kpisCreated + second.kpisCreated,
    projectsImported: first.projectsImported + second.projectsImported,
    projectsSkipped: first.projectsSkipped + second.projectsSkipped,
    knowledgeImported: first.knowledgeImported + second.knowledgeImported,
    knowledgeSkippedDuplicates: first.knowledgeSkippedDuplicates + second.knowledgeSkippedDuplicates,
    skillsWritten: first.skillsWritten + second.skillsWritten,
    skillsDeferred: first.skillsDeferred + second.skillsDeferred,
    twinsImported: first.twinsImported + second.twinsImported,
    twinsSkipped: first.twinsSkipped + second.twinsSkipped,
    twinKbChunksImported: first.twinKbChunksImported + second.twinKbChunksImported,
    athenaMemoryImported: first.athenaMemoryImported + second.athenaMemoryImported,
    // Identity replacement is a one-shot event, not a counter — either pass
    // having done it means the local identity was overwritten.
    athenaIdentityReplaced: first.athenaIdentityReplaced || second.athenaIdentityReplaced,
    reembedQueued: first.reembedQueued + second.reembedQueued,
    warnings: [...first.warnings, ...second.warnings],
    idMapping: { ...first.idMapping, ...second.idMapping },
    importConflicts: [],
    bundleFilePath: null,
  };
}

export function useDataPortability() {
  const { t } = useTranslation();
  const s = t.settings.portability;
  const [stats, setStats] = useState<ExportStats | null>(null);
  const [statsStatus, setStatsStatus] = useState<Status>('idle');

  const [exportStatus, setExportStatus] = useState<Status>('idle');
  const [importStatus, setImportStatus] = useState<Status>('idle');
  const [importResult, setImportResult] = useState<PortabilityImportResult | null>(null);
  // Conflict pass — pass 1 imported everything else; these hold what the
  // resolution pass needs to re-invoke without re-picking the file. Conflicts
  // now cover dev projects AND twins, keyed `"<kind>:<bundleId>"`.
  const [conflictImportFilePath, setConflictImportFilePath] = useState<string | null>(null);
  const [pendingImportPassphrase, setPendingImportPassphrase] = useState<string | undefined>(undefined);

  const [credExportStatus, setCredExportStatus] = useState<Status>('idle');
  const [credImportStatus, setCredImportStatus] = useState<Status>('idle');
  const [credImportResult, setCredImportResult] = useState<CredentialImportResult | null>(null);
  const [credImportFilePath, setCredImportFilePath] = useState<string | null>(null);
  const [credExportPassphrase, setCredExportPassphrase] = useState('');
  const [credImportPassphrase, setCredImportPassphrase] = useState('');
  const [showCredExportInput, setShowCredExportInput] = useState(false);
  const [showCredImportInput, setShowCredImportInput] = useState(false);

  const [showExportModal, setShowExportModal] = useState(false);

  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const cached = exportStatsCache.get(STATS_KEY);
    if (cached) {
      setStats(cached);
      setStatsStatus('success');
      return;
    }
    setStatsStatus('loading');
    getExportStats()
      .then((s) => {
        exportStatsCache.set(STATS_KEY, s);
        setStats(s);
        setStatsStatus('success');
      })
      .catch((err) => {
        silentCatch("useDataPortability:getExportStats")(err);
        setStatsStatus('error');
      });
  }, []);

  const handleExportFull = useCallback(async (includeMemories: boolean, passphrase?: string) => {
    if (exportStatus === 'loading') return;
    setExportStatus('loading');
    setErrorMsg('');
    try {
      const saved = await exportFull(includeMemories, passphrase);
      setExportStatus(saved ? 'success' : 'idle');
    } catch (e) {
      silentCatch("useDataPortability:exportFull")(e);
      setErrorMsg(errMsg(e, s.export_failed));
      setExportStatus('error');
    }
  }, [exportStatus, s.export_failed]);

  // One options object end to end — see `ExportSelectionArgs`. The previous
  // 8-positional-`string[]` signature made a transposed scope invisible to tsc.
  const handleExportSelective = useCallback(async (args: ExportSelectionArgs) => {
    if (exportStatus === 'loading') return;
    setExportStatus('loading');
    setErrorMsg('');
    try {
      const saved = await exportSelective(args);
      setExportStatus(saved ? 'success' : 'idle');
      if (saved) setShowExportModal(false);
    } catch (e) {
      silentCatch("useDataPortability:exportSelective")(e);
      setErrorMsg(errMsg(e, s.selective_export_failed));
      setExportStatus('error');
    }
  }, [exportStatus, s.selective_export_failed]);

  const refreshStats = useCallback(() => {
    // Import changed the counts — refresh stats and the module cache so a
    // later remount of this tab seeds from the fresh value, not the stale one.
    getExportStats()
      .then((fresh) => { exportStatsCache.set(STATS_KEY, fresh); setStats(fresh); })
      .catch(silentCatch("useDataPortability:refreshExportStats"));
  }, []);

  const handleImport = useCallback(async (passphrase?: string) => {
    if (importStatus === 'loading') return;
    // Block a fresh import while a conflict-resolution pass is pending; the
    // stored passphrase belongs to that pass and a silent re-run would double-import.
    if (conflictImportFilePath) return;
    setImportStatus('loading');
    setImportResult(null);
    setErrorMsg('');
    try {
      const result = await importPortabilityBundle(passphrase);
      if (result) {
        setImportResult(result);
        if (result.importConflicts.length > 0 && result.bundleFilePath) {
          // Conflicts detected — pass 1 imported everything else; hold the
          // bundle path + passphrase for the resolution pass.
          setConflictImportFilePath(result.bundleFilePath);
          setPendingImportPassphrase(passphrase);
          setImportStatus('idle');
        } else {
          setImportStatus('success');
        }
        refreshStats();
      } else {
        setImportStatus('idle');
      }
    } catch (e) {
      silentCatch("useDataPortability:importPortabilityBundle")(e);
      setErrorMsg(errMsg(e, s.import_failed));
      setImportStatus('error');
    }
  }, [importStatus, conflictImportFilePath, refreshStats, s.import_failed]);

  const handleImportWithResolutions = useCallback(async (resolutions: Record<string, string>) => {
    if (importStatus === 'loading') return;
    if (!conflictImportFilePath) {
      setErrorMsg(s.no_import_file);
      return;
    }
    setImportStatus('loading');
    setErrorMsg('');
    try {
      const result = await importPortabilityBundle(
        pendingImportPassphrase,
        JSON.stringify(resolutions),
        conflictImportFilePath,
      );
      if (result) {
        setImportResult((prev) => (prev ? mergeImportResults(prev, result) : result));
        setImportStatus('success');
        refreshStats();
      } else {
        setImportStatus('idle');
      }
      setConflictImportFilePath(null);
      setPendingImportPassphrase(undefined);
    } catch (e) {
      silentCatch("useDataPortability:importPortabilityBundleResolutions")(e);
      setErrorMsg(errMsg(e, s.import_failed));
      setImportStatus('error');
    }
  }, [importStatus, conflictImportFilePath, pendingImportPassphrase, refreshStats, s.no_import_file, s.import_failed]);

  const dismissImportConflicts = useCallback(() => {
    // Cancel = conflicted items simply not imported; pass 1 already landed.
    setConflictImportFilePath(null);
    setPendingImportPassphrase(undefined);
    setImportResult((prev) => (prev ? { ...prev, import_conflicts: [], bundle_file_path: null } : prev));
    setImportStatus('success');
  }, []);

  const handleCredExport = useCallback(async () => {
    if (credExportStatus === 'loading') return;
    if (credExportPassphrase.length < 8) {
      setErrorMsg(s.passphrase_too_short);
      return;
    }
    setCredExportStatus('loading');
    setErrorMsg('');
    try {
      const saved = await exportCredentials(credExportPassphrase);
      setCredExportStatus(saved ? 'success' : 'idle');
      if (saved) {
        setShowCredExportInput(false);
        setCredExportPassphrase('');
      }
    } catch (e) {
      silentCatch("useDataPortability:exportCredentials")(e);
      setErrorMsg(errMsg(e, s.cred_export_failed));
      setCredExportStatus('error');
    }
  }, [credExportPassphrase, credExportStatus, s.cred_export_failed, s.passphrase_too_short]);

  const handleCredImport = useCallback(async () => {
    if (credImportStatus === 'loading') return;
    // Block starting a fresh import while a conflict-resolution pass is pending;
    // the stored passphrase belongs to that pass and a silent re-run would double-import.
    if (credImportFilePath) return;
    if (!credImportPassphrase) {
      setErrorMsg(s.please_enter_passphrase);
      return;
    }
    if (credImportPassphrase.length < 8) {
      setErrorMsg(s.passphrase_too_short);
      return;
    }
    setCredImportStatus('loading');
    setCredImportResult(null);
    setCredImportFilePath(null);
    setErrorMsg('');
    try {
      const result = await importCredentials(credImportPassphrase);
      if (result) {
        setCredImportResult(result);
        if (result.conflicts.length > 0 && result.filePath) {
          // Conflicts detected — keep passphrase and store file path for resolution pass
          setCredImportFilePath(result.filePath);
          setCredImportStatus('idle');
        } else {
          setCredImportStatus('success');
          setShowCredImportInput(false);
          setCredImportPassphrase('');
        }
      } else {
        setCredImportStatus('idle');
      }
    } catch (e) {
      silentCatch("useDataPortability:importCredentials")(e);
      setErrorMsg(errMsg(e, s.cred_import_failed));
      setCredImportStatus('error');
    }
  }, [credImportStatus, credImportFilePath, credImportPassphrase, s.please_enter_passphrase, s.passphrase_too_short, s.cred_import_failed]);

  const handleCredImportWithResolutions = useCallback(async (resolutions: Record<string, string>) => {
    if (credImportStatus === 'loading') return;
    if (!credImportFilePath) {
      setErrorMsg(s.no_import_file);
      return;
    }
    setCredImportStatus('loading');
    setErrorMsg('');
    try {
      const result = await importCredentials(credImportPassphrase, JSON.stringify(resolutions), credImportFilePath);
      if (result) {
        setCredImportResult(result);
        setCredImportStatus('success');
        setShowCredImportInput(false);
        setCredImportPassphrase('');
        setCredImportFilePath(null);
      } else {
        setCredImportStatus('idle');
      }
    } catch (e) {
      silentCatch("useDataPortability:importCredentials")(e);
      setErrorMsg(errMsg(e, s.cred_import_failed));
      setCredImportStatus('error');
    }
  }, [credImportStatus, credImportFilePath, s.no_import_file, s.cred_import_failed, credImportPassphrase]);

  return {
    stats,
    statsStatus,
    exportStatus,
    importStatus,
    importResult,
    credExportStatus,
    credImportStatus,
    credImportResult,
    credExportPassphrase,
    setCredExportPassphrase,
    credImportPassphrase,
    setCredImportPassphrase,
    showCredExportInput,
    setShowCredExportInput,
    showCredImportInput,
    setShowCredImportInput,
    showExportModal,
    setShowExportModal,
    errorMsg,
    handleExportFull,
    handleExportSelective,
    handleImport,
    handleImportWithResolutions,
    dismissImportConflicts,
    handleCredExport,
    handleCredImport,
    handleCredImportWithResolutions,
  };
}
