// Static Scan — the deterministic-tool lane (fallow/knip/jscpd), relocated
// from the retired Idea Scanner page. With no tool configured, the button
// opens the config modal instead of firing a run guaranteed to fail.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Info, Zap } from 'lucide-react';

import { runStaticScan } from '@/api/devTools/devTools';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { StaticScanConfig } from '@/lib/bindings/StaticScanConfig';
import { extractMessage, toastCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';

import { StaticScanConfigModal } from './StaticScanConfigModal';

export function StaticScanCard({ projectId }: { projectId: string }) {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;
  const activeProject = useSystemStore((s) => s.projects.find((p) => p.id === projectId));
  const fetchProjects = useSystemStore((s) => s.fetchProjects);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const parsedConfig = useMemo<StaticScanConfig | null>(() => {
    const raw = activeProject?.static_scan_config;
    if (!raw) return null;
    try { return JSON.parse(raw) as StaticScanConfig; } catch { return null; }
  }, [activeProject?.static_scan_config]);

  const runNow = useCallback(async () => {
    setRunning(true);
    setStatus(d.skills_static_running);
    try {
      const result = await runStaticScan(projectId);
      setStatus(tx(d.skills_static_complete, { count: result.ideas_created }));
      setTimeout(() => { if (mountedRef.current) setStatus(null); }, 4000);
    } catch (err) {
      setStatus(tx(d.skills_static_failed, { error: extractMessage(err) }));
      toastCatch('StaticScanCard:run')(err);
      setTimeout(() => { if (mountedRef.current) setStatus(null); }, 6000);
    } finally {
      if (mountedRef.current) setRunning(false);
    }
  }, [projectId, d, tx]);

  const handleRun = useCallback(() => {
    if (running) return;
    if (!parsedConfig) { setConfigOpen(true); return; }
    void runNow();
  }, [running, parsedConfig, runNow]);

  return (
    <div className="flex items-center gap-3 rounded-card border border-primary/12 bg-secondary/[0.12] px-3 py-2">
      <Zap className="w-4 h-4 text-status-success flex-shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <Tooltip content={d.skills_static_subtitle} placement="top">
          <span className="inline-flex items-center gap-1.5 typo-body font-semibold text-foreground">
            {d.skills_static_title}
            <Info className="w-3 h-3 text-foreground/35" aria-hidden />
          </span>
        </Tooltip>
        {status && <span className="typo-label text-foreground/45 truncate block">{status}</span>}
      </span>
      <Button variant="secondary" size="sm" loading={running} onClick={handleRun} data-testid="static-scan-run">
        {parsedConfig ? d.skills_static_run : d.skills_static_configure}
      </Button>
      <StaticScanConfigModal
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        projectId={projectId}
        initialConfig={parsedConfig}
        onSaved={() => { void Promise.resolve(fetchProjects?.()).then(() => { void runNow(); }); }}
      />
    </div>
  );
}
