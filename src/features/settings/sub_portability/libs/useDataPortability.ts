import { silentCatch } from "@/lib/silentCatch";
import { useState, useEffect, useCallback } from 'react';
import * as Sentry from "@sentry/react";
import {
  getExportStats,
  exportFull,
  exportSelective,
  importPortabilityBundle,
  exportCredentials,
  importCredentials,
} from '@/api/system/dataPortability';
import { errMsg } from '@/stores/storeTypes';
import type {
  ExportStats,
  PortabilityImportResult,
  CredentialImportResult,
} from '@/api/system/dataPortability';

type Status = 'idle' | 'loading' | 'success' | 'error';

export function useDataPortability() {
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
      .catch(() => setStatsStatus('error'));
  }, []);

  const handleExportFull = useCallback(async (passphrase?: string) => {
    if (exportStatus === 'loading') return;
    setExportStatus('loading');
    setErrorMsg('');
    try {
      const saved = await exportFull(passphrase);
      setExportStatus(saved ? 'success' : 'idle');
    } catch (e) {
      Sentry.captureException(e);
      setErrorMsg(errMsg(e, "Export failed"));
      setExportStatus('error');
    }
  }, [exportStatus]);

  const handleExportSelective = useCallback(async (
    personaIds: string[],
    teamIds: string[],
    credentialIds: string[],
    passphrase?: string,
  ) => {
    if (exportStatus === 'loading') return;
    setExportStatus('loading');
    setErrorMsg('');
    try {
      const saved = await exportSelective(personaIds, teamIds, credentialIds, passphrase);
      setExportStatus(saved ? 'success' : 'idle');
      if (saved) setShowExportModal(false);
    } catch (e) {
      Sentry.captureException(e);
      setErrorMsg(errMsg(e, "Selective export failed"));
      setExportStatus('error');
    }
  }, [exportStatus]);

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
      Sentry.captureException(e);
      setErrorMsg(errMsg(e, "Import failed"));
      setImportStatus('error');
    }
  }, [importStatus]);

  const handleCredExport = useCallback(async () => {
    if (credExportStatus === 'loading') return;
    if (credExportPassphrase.length < 8) {
      setErrorMsg('Passphrase must be at least 8 characters');
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
      Sentry.captureException(e);
      setErrorMsg(errMsg(e, "Credential export failed"));
      setCredExportStatus('error');
    }
  }, [credExportPassphrase, credExportStatus]);

  const handleCredImport = useCallback(async () => {
    if (credImportStatus === 'loading') return;
    // Block starting a fresh import while a conflict-resolution pass is pending;
    // the stored passphrase belongs to that pass and a silent re-run would double-import.
    if (credImportFilePath) return;
    if (!credImportPassphrase) {
      setErrorMsg('Please enter the passphrase used during export');
      return;
    }
    if (credImportPassphrase.length < 8) {
      setErrorMsg('Passphrase must be at least 8 characters');
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
      Sentry.captureException(e);
      setErrorMsg(errMsg(e, "Credential import failed"));
      setCredImportStatus('error');
    }
  }, [credImportPassphrase, credImportStatus, credImportFilePath]);

  const handleCredImportWithResolutions = useCallback(async (resolutions: Record<string, string>) => {
    if (credImportStatus === 'loading') return;
    if (!credImportFilePath) {
      setErrorMsg('No import file available — please start the import again');
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
      Sentry.captureException(e);
      setErrorMsg(errMsg(e, "Credential import failed"));
      setCredImportStatus('error');
    }
  }, [credImportPassphrase, credImportStatus, credImportFilePath]);

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
