import { useState, useEffect, useCallback } from 'react';
import {
  HardDriveDownload,
  Upload,
  Download,
  PackageCheck,
  AlertTriangle,
  Check,
  Loader2,
  ArrowRightLeft,
} from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import {
  getExportStats,
  exportFull,
  importPortabilityBundle,
  previewCompetitiveImport,
} from '@/api/dataPortability';
import type {
  ExportStats,
  PortabilityImportResult,
  CompetitiveImportPreview,
} from '@/api/dataPortability';

type Status = 'idle' | 'loading' | 'success' | 'error';

export default function DataPortabilitySettings() {
  const [stats, setStats] = useState<ExportStats | null>(null);
  const [statsStatus, setStatsStatus] = useState<Status>('idle');

  const [exportStatus, setExportStatus] = useState<Status>('idle');
  const [importStatus, setImportStatus] = useState<Status>('idle');
  const [importResult, setImportResult] = useState<PortabilityImportResult | null>(null);

  const [competitiveStatus, setCompetitiveStatus] = useState<Status>('idle');
  const [competitivePreviews, setCompetitivePreviews] = useState<CompetitiveImportPreview[]>([]);

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

  const handleCompetitiveImport = useCallback(async () => {
    setCompetitiveStatus('loading');
    setCompetitivePreviews([]);
    setErrorMsg('');
    try {
      const previews = await previewCompetitiveImport();
      if (previews) {
        setCompetitivePreviews(previews);
        setCompetitiveStatus('success');
      } else {
        setCompetitiveStatus('idle'); // user cancelled
      }
    } catch (e) {
      setErrorMsg(String(e));
      setCompetitiveStatus('error');
    }
  }, []);

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

          {/* Export section */}
          <div className="rounded-xl border border-primary/10 bg-card-bg p-6 space-y-4">
            <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">
              Export
            </h2>
            <p className="text-sm text-muted-foreground/70">
              Export your workspace to a portable ZIP archive containing all personas, teams,
              tools, connectors, memories, and test suites.
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
                    : 'Full Export'}
              </button>
            </div>
          </div>

          {/* Import section */}
          <div className="rounded-xl border border-primary/10 bg-card-bg p-6 space-y-4">
            <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">
              Import
            </h2>
            <p className="text-sm text-muted-foreground/70">
              Restore from a previously exported archive. Imported items are created as new
              entities (disabled by default) to avoid conflicts.
            </p>

            <div className="flex flex-wrap gap-3">
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

          {/* Competitive import section */}
          <div className="rounded-xl border border-primary/10 bg-card-bg p-6 space-y-4">
            <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">
              Migrate from Other Platforms
            </h2>
            <p className="text-sm text-muted-foreground/70">
              Import workflows from n8n, Zapier, or Make/Integromat. Select a workflow
              JSON export to preview how it maps to persona agents.
            </p>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={handleCompetitiveImport}
                disabled={competitiveStatus === 'loading'}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium
                  bg-violet-500/10 text-violet-400 border border-violet-500/20 hover:bg-violet-500/15
                  transition-colors disabled:opacity-50"
              >
                {competitiveStatus === 'loading' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ArrowRightLeft className="w-4 h-4" />
                )}
                {competitiveStatus === 'loading' ? 'Analyzing...' : 'Import Workflow'}
              </button>
            </div>

            {/* Competitive preview results */}
            {competitivePreviews.length > 0 && (
              <div className="space-y-3">
                {competitivePreviews.map((preview, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-4 space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/25 font-medium">
                        {preview.source_platform}
                      </span>
                      <span className="text-sm font-medium text-foreground/90">
                        {preview.workflow_name}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground/70">{preview.description}</p>
                    {preview.suggested_tools.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {preview.suggested_tools.map((tool, j) => (
                          <span
                            key={j}
                            className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-muted-foreground/80 border border-primary/10"
                          >
                            {tool}
                          </span>
                        ))}
                      </div>
                    )}
                    {preview.suggested_triggers.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {preview.suggested_triggers.map((trigger, j) => (
                          <span
                            key={j}
                            className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400/80 border border-amber-500/15"
                          >
                            {trigger}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
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
