/**
 * StandardsScanCard — Overview surface for the golden-standard scan (Stage 3b).
 *
 * Triggers `dev_tools_run_standards_scan`, listens for the
 * `dev_tools_standards_scan_status` event to know when it finishes, and renders
 * the per-rule compliance findings from `dev_standards`.
 */
import { useEffect, useMemo, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { ShieldCheck, ScanSearch } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { silentCatch } from '@/lib/silentCatch';

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'error' | 'neutral'> = {
  present: 'success',
  partial: 'warning',
  missing: 'error',
};
const STATUS_WEIGHT: Record<string, number> = { present: 1, partial: 0.5, missing: 0 };

export function StandardsScanCard({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const dp = t.plugins.dev_projects;
  const standards = useSystemStore((s) => s.standards);
  const fetchStandards = useSystemStore((s) => s.fetchStandards);
  const runStandardsScan = useSystemStore((s) => s.runStandardsScan);
  const [scanning, setScanning] = useState(false);

  useEffect(() => { void fetchStandards(projectId); }, [projectId, fetchStandards]);

  // Stop the spinner + refresh findings when the scan reports done.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ project_id?: string; status?: string }>('dev_tools_standards_scan_status', (e) => {
      if (e.payload?.project_id !== projectId) return;
      if (e.payload.status === 'complete' || e.payload.status === 'error') {
        setScanning(false);
        void fetchStandards(projectId);
      }
    })
      .then((f) => { unlisten = f; })
      .catch(silentCatch('StandardsScanCard:listen'));
    return () => { unlisten?.(); };
  }, [projectId, fetchStandards]);

  const handleScan = async () => {
    setScanning(true);
    await runStandardsScan(projectId);
  };

  const compliancePct = useMemo(() => {
    if (standards.length === 0) return null;
    const sum = standards.reduce((acc, s) => acc + (STATUS_WEIGHT[s.status] ?? 0), 0);
    return Math.round((sum / standards.length) * 100);
  }, [standards]);

  return (
    <div className="mt-4 rounded-card border border-primary/10 bg-card/20">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-primary/8">
        <ShieldCheck className="w-3.5 h-3.5 text-amber-400/80 flex-shrink-0" />
        <span className="typo-card-label">{dp.standards_scan_title}</span>
        {compliancePct !== null && (
          <span className="typo-caption text-foreground/60 tabular-nums">
            {compliancePct}% {dp.standards_compliance}
          </span>
        )}
        <Button
          variant="secondary"
          size="xs"
          className="ml-auto"
          icon={scanning ? <LoadingSpinner size="sm" /> : <ScanSearch className="w-3 h-3" />}
          disabled={scanning}
          onClick={handleScan}
        >
          {scanning ? dp.standards_scan_running : dp.standards_scan_run}
        </Button>
      </div>

      {standards.length === 0 ? (
        <p className="px-4 py-4 typo-caption text-foreground/50 text-center">
          {scanning ? dp.standards_scan_running : dp.standards_scan_empty}
        </p>
      ) : (
        <ul className="divide-y divide-primary/5 max-h-72 overflow-y-auto">
          {standards.map((s) => (
            <li key={s.id} className="flex items-center gap-2.5 px-4 py-2">
              <StatusBadge variant={STATUS_VARIANT[s.status] ?? 'neutral'} pill>{s.status}</StatusBadge>
              <span className="min-w-0 flex-1">
                <span className="typo-caption text-foreground truncate block">{s.title}</span>
                {s.recommendation && s.status !== 'present' && (
                  <span className="typo-caption text-foreground/50 truncate block">{s.recommendation}</span>
                )}
              </span>
              <span className="typo-caption text-foreground/40 shrink-0">{s.category}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
