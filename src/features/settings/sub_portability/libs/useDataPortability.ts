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

  const handleExportFull = useCallback(async () => {
    setExportStatus('loading');
    setErrorMsg('');
    try {
      const saved = await exportFull();
      setExportStatus(saved ? 'success' : 'idle');
    } catch (e) {
      setErrorMsg(String(e));
      setExportStatus('error');
    }
  }, []);

  const handleExportSelective = useCallback(async (
    personaIds: string[],
    teamIds: string[],
    connectorIds: string[],
  ) => {
    setExportStatus('loading');
    setErrorMsg('');
    try {
      const saved = await exportSelective(personaIds, teamIds, connectorIds);
      setExportStatus(saved ? 'success' : 'idle');
      if (saved) setShowExportModal(false);
    } catch (e) {
      setErrorMsg(String(e));
      setExportStatus('error');
    }
  }, []);

  const handleImport = useCallback(async () => {
    setImportStatus('loading');
    setImportResult(null);
    setErrorMsg('');
    try {
      const result = await importPortabilityBundle();
      if (result) {
        setImportResult(result);
        setImportStatus('success');
        getExportStats().then(setStats).catch(silentCatch("useDataPortability:refreshExportStats"));
      } else {
        setImportStatus('idle');
      }
    } catch (e) {
      setErrorMsg(String(e));
      setImportStatus('error');
    }
  }, []);

  const handleCredExport = useCallback(async () => {
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
      setErrorMsg(String(e));
      setCredExportStatus('error');
    }
  }, [credExportPassphrase]);

  const handleCredImport = useCallback(async () => {
    if (!credImportPassphrase) {
      setErrorMsg('Please enter the passphrase used during export');
      return;
    }
    setCredImportStatus('loading');
    setCredImportResult(null);
    setErrorMsg('');
    try {
      const result = await importCredentials(credImportPassphrase);
      if (result) {
        setCredImportResult(result);
        setCredImportStatus('success');
        setShowCredImportInput(false);
        setCredImportPassphrase('');
      } else {
        setCredImportStatus('idle');
      }
    } catch (e) {
      setErrorMsg(String(e));
      setCredImportStatus('error');
    }
  }, [credImportPassphrase]);

  const handleCredImportWithResolutions = useCallback(async (resolutions: Record<string, string>) => {
    setCredImportStatus('loading');
    setErrorMsg('');
    try {
      const result = await importCredentials(credImportPassphrase, JSON.stringify(resolutions));
      if (result) {
        setCredImportResult(result);
        setCredImportStatus('success');
        setShowCredImportInput(false);
        setCredImportPassphrase('');
      } else {
        setCredImportStatus('idle');
      }
    } catch (e) {
      setErrorMsg(String(e));
      setCredImportStatus('error');
    }
  }, [credImportPassphrase]);

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
