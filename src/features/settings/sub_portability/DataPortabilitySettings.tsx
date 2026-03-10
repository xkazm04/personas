import { useState, useEffect, useCallback } from 'react';
import {
  HardDriveDownload,
  Upload,
  Download,
  PackageCheck,
  AlertTriangle,
  Check,
  Loader2,
  ShieldCheck,
  KeyRound,
} from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import {
  getExportStats,
  exportFull,
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

export default function DataPortabilitySettings() {
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

  const [errorMsg, setErrorMsg] = useState('');

  // Load stats on mount
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

  const handleImport = useCallback(async () => {
    setImportStatus('loading');
    setImportResult(null);
    setErrorMsg('');
    try {
      const result = await importPortabilityBundle();
      if (result) {
        setImportResult(result);
        setImportStatus('success');
        // Refresh stats
        getExportStats().then(setStats).catch(() => {});
      } else {
        setImportStatus('idle'); // user cancelled
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

  return (
    <ContentBox>
      <ContentHeader
        icon={<HardDriveDownload className="w-5 h-5 text-emerald-400" />}
        iconColor="emerald"
        title="Data Portability"
        subtitle="Export, import, and migrate your workspace data"
      />

      <ContentBody centered>
        <div className="space-y-6">
          {/* Workspace overview */}
          <div className="rounded-xl border border-primary/10 bg-card-bg p-6 space-y-4">
            <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">
              Workspace Overview
            </h2>

            {statsStatus === 'loading' && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground/70">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading workspace stats...
              </div>
            )}

            {statsStatus === 'error' && (
              <p className="text-sm text-red-400">Failed to load workspace statistics.</p>
            )}

            {stats && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Personas" value={stats.persona_count} />
                <StatCard label="Teams" value={stats.team_count} />
                <StatCard label="Tools" value={stats.tool_count} />
                <StatCard label="Groups" value={stats.group_count} />
                <StatCard label="Connectors" value={stats.connector_count} />
                <StatCard label="Memories" value={stats.memory_count} />
                <StatCard label="Test Suites" value={stats.test_suite_count} />
              </div>
            )}
          </div>

          {/* Workspace Export & Import */}
          <div className="rounded-xl border border-primary/10 bg-card-bg p-6 space-y-4">
            <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">
              Workspace Export & Import
            </h2>
            <p className="text-sm text-muted-foreground/70">
              Export your workspace to a portable ZIP archive containing all personas, teams,
              tools, connectors, memories, and test suites. Import restores from a previously
              exported archive — imported items are created as new entities (disabled by default).
            </p>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={handleExportFull}
                disabled={exportStatus === 'loading'}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
                  bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/15
                  transition-colors disabled:opacity-50"
              >
                {exportStatus === 'loading' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : exportStatus === 'success' ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                {exportStatus === 'loading'
                  ? 'Exporting...'
                  : exportStatus === 'success'
                    ? 'Exported!'
                    : 'Export Workspace'}
              </button>

              <button
                onClick={handleImport}
                disabled={importStatus === 'loading'}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
                  bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/15
                  transition-colors disabled:opacity-50"
              >
                {importStatus === 'loading' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : importStatus === 'success' ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                {importStatus === 'loading'
                  ? 'Importing...'
                  : importStatus === 'success'
                    ? 'Imported!'
                    : 'Import Archive'}
              </button>
            </div>

            {/* Import result */}
            {importResult && (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-emerald-400">
                  <PackageCheck className="w-4 h-4" />
                  Import Complete
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm text-muted-foreground/80">
                  {importResult.personas_created > 0 && (
                    <span>{importResult.personas_created} persona(s)</span>
                  )}
                  {importResult.teams_created > 0 && (
                    <span>{importResult.teams_created} team(s)</span>
                  )}
                  {importResult.tools_created > 0 && (
                    <span>{importResult.tools_created} tool(s)</span>
                  )}
                  {importResult.groups_created > 0 && (
                    <span>{importResult.groups_created} group(s)</span>
                  )}
                  {importResult.connectors_created > 0 && (
                    <span>{importResult.connectors_created} connector(s)</span>
                  )}
                </div>
                {importResult.warnings.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <p className="text-sm font-medium text-amber-400">Warnings:</p>
                    {importResult.warnings.map((w, i) => (
                      <p key={i} className="text-sm text-muted-foreground/70 pl-2">
                        - {w}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Credential vault export/import */}
          <div className="rounded-xl border border-primary/10 bg-card-bg p-6 space-y-4">
            <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">
              Credential Vault
            </h2>
            <div className="flex items-start gap-2 text-sm text-muted-foreground/70">
              <ShieldCheck className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-400/70" />
              <p>
                Workspace exports do not include credential secrets. Use this section to
                export and import your vault with password-protected AES-256 encryption.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              {/* Export credentials */}
              <div className="space-y-2">
                {!showCredExportInput ? (
                  <button
                    onClick={() => setShowCredExportInput(true)}
                    disabled={credExportStatus === 'loading'}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
                      bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/15
                      transition-colors disabled:opacity-50"
                  >
                    {credExportStatus === 'success' ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <KeyRound className="w-4 h-4" />
                    )}
                    {credExportStatus === 'success' ? 'Exported!' : 'Export Credentials'}
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      type="password"
                      placeholder="Passphrase (min 8 chars)"
                      value={credExportPassphrase}
                      onChange={(e) => setCredExportPassphrase(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleCredExport()}
                      className="px-3 py-2 rounded-lg border border-primary/15 bg-secondary/20 text-sm
                        text-foreground/90 placeholder:text-muted-foreground/40 outline-none
                        focus:border-amber-500/30 w-56"
                      autoFocus
                    />
                    <button
                      onClick={handleCredExport}
                      disabled={credExportStatus === 'loading'}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium
                        bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/15
                        transition-colors disabled:opacity-50"
                    >
                      {credExportStatus === 'loading' ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Download className="w-4 h-4" />
                      )}
                      Export
                    </button>
                    <button
                      onClick={() => { setShowCredExportInput(false); setCredExportPassphrase(''); }}
                      className="text-xs text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>

              {/* Import credentials */}
              <div className="space-y-2">
                {!showCredImportInput ? (
                  <button
                    onClick={() => setShowCredImportInput(true)}
                    disabled={credImportStatus === 'loading'}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
                      bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/15
                      transition-colors disabled:opacity-50"
                  >
                    {credImportStatus === 'success' ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                    {credImportStatus === 'success' ? 'Imported!' : 'Import Credentials'}
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      type="password"
                      placeholder="Passphrase"
                      value={credImportPassphrase}
                      onChange={(e) => setCredImportPassphrase(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleCredImport()}
                      className="px-3 py-2 rounded-lg border border-primary/15 bg-secondary/20 text-sm
                        text-foreground/90 placeholder:text-muted-foreground/40 outline-none
                        focus:border-blue-500/30 w-56"
                      autoFocus
                    />
                    <button
                      onClick={handleCredImport}
                      disabled={credImportStatus === 'loading'}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium
                        bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/15
                        transition-colors disabled:opacity-50"
                    >
                      {credImportStatus === 'loading' ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Upload className="w-4 h-4" />
                      )}
                      Import
                    </button>
                    <button
                      onClick={() => { setShowCredImportInput(false); setCredImportPassphrase(''); }}
                      className="text-xs text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Import result */}
            {credImportResult && (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-emerald-400">
                  <PackageCheck className="w-4 h-4" />
                  Credential Import Complete
                </div>
                <p className="text-sm text-muted-foreground/80">
                  {credImportResult.created} credential(s) imported
                </p>
                {credImportResult.warnings.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <p className="text-sm font-medium text-amber-400">Warnings:</p>
                    {credImportResult.warnings.map((w, i) => (
                      <p key={i} className="text-sm text-muted-foreground/70 pl-2">
                        - {w}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Error display */}
          {errorMsg && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-muted-foreground/80">
                <p className="font-medium text-red-400/90 mb-1">Error</p>
                <p>{errorMsg}</p>
              </div>
            </div>
          )}
        </div>
      </ContentBody>
    </ContentBox>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-primary/10 bg-secondary/10 p-3 text-center">
      <div className="text-lg font-semibold text-foreground/90">{value}</div>
      <div className="text-xs text-muted-foreground/70">{label}</div>
    </div>
  );
}
