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
import type {
  ExportStats,
  PortabilityImportResult,
  CredentialImportResult,
} from '@/api/system/dataPortability';

type Status = 'idle' | 'loading' | 'success' | 'error';

export function useDataPortability() {
  const { t } = useTranslation();
  const s = t.settings.portability;
  const [stats, setStats] = useState<ExportStats | null>(null);
  const [statsStatus, setStatsStatus] = useState<Status>('idle');

  const [exportStatus, setExportStatus] = useState<Status>('idle');
  const [importStatus, setImportStatus] = useState<Status>('idle');
  const [importResult, setImportResult] = useState<PortabilityImportResult | null>(null);

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
    setStatsStatus('loading');
    getExportStats()
      .then((s) => {
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

  const handleExportSelective = useCallback(async (
    personaIds: string[],
    teamIds: string[],
    credentialIds: string[],
    includeMemories: boolean,
    passphrase?: string,
  ) => {
    if (exportStatus === 'loading') return;
    setExportStatus('loading');
    setErrorMsg('');
    try {
      const saved = await exportSelective(personaIds, teamIds, credentialIds, includeMemories, passphrase);
      setExportStatus(saved ? 'success' : 'idle');
      if (saved) setShowExportModal(false);
    } catch (e) {
      silentCatch("useDataPortability:exportSelective")(e);
      setErrorMsg(errMsg(e, s.selective_export_failed));
      setExportStatus('error');
    }
  }, [exportStatus, s.selective_export_failed]);

  const handleImport = useCallback(async (passphrase?: string) => {
    if (importStatus === 'loading') return;
    setImportStatus('loading');
    setImportResult(null);
    setErrorMsg('');
    try {
      const result = await importPortabilityBundle(passphrase);
      if (result) {
        setImportResult(result);
        setImportStatus('success');
        getExportStats().then(setStats).catch(silentCatch("useDataPortability:refreshExportStats"));
      } else {
        setImportStatus('idle');
      }
    } catch (e) {
      silentCatch("useDataPortability:importPortabilityBundle")(e);
      setErrorMsg(errMsg(e, s.import_failed));
      setImportStatus('error');
    }
  }, [importStatus, s.import_failed]);

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
        if (result.conflicts.length > 0 && result.file_path) {
          // Conflicts detected — keep passphrase and store file path for resolution pass
          setCredImportFilePath(result.file_path);
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
    handleCredExport,
    handleCredImport,
    handleCredImportWithResolutions,
  };
}
