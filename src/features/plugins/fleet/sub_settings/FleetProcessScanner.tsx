import { useState, useEffect, useCallback } from 'react';
import { Cpu, RefreshCw, Skull, ShieldCheck, AlertTriangle } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { TruncateWithTooltip } from '@/features/shared/components/display/TruncateWithTooltip';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { detectProcesses, killPid } from '@/api/fleet/fleet';
import { toastCatch, silentCatch } from '@/lib/silentCatch';
import type { FleetDetectedProcess } from '@/lib/bindings/FleetDetectedProcess';

function fmtMem(bytes: bigint): string {
  const mb = Number(bytes) / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
}

/**
 * Detected-process diagnostics + orphan cleanup.
 *
 * The in-memory session registry is lost on app restart, but the `claude`
 * child processes can survive — orphans otherwise reachable only via Task
 * Manager. This scans the OS process table for Claude CLI processes, marks
 * which are still Fleet-tracked, and lets the user kill orphans by PID.
 */
export function FleetProcessScanner() {
  const [procs, setProcs] = useState<FleetDetectedProcess[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [killing, setKilling] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<FleetDetectedProcess | null>(null);

  const scan = useCallback(() => {
    setBusy(true);
    detectProcesses()
      .then(setProcs)
      .catch(silentCatch('FleetProcessScanner:scan'))
      .finally(() => setBusy(false));
  }, []);

  useEffect(() => {
    scan();
  }, [scan]);

  const doKill = useCallback(async (pid: number) => {
    setKilling(pid);
    try {
      await killPid(pid);
      setProcs((cur) => cur?.filter((p) => p.pid !== pid) ?? null);
    } catch (e) {
      toastCatch('FleetProcessScanner:kill', 'Failed to kill process')(e);
    } finally {
      setKilling(null);
      setConfirm(null);
    }
  }, []);

  const orphans = procs?.filter((p) => !p.tracked).length ?? 0;

  return (
    <div
      className="border border-primary/10 rounded-modal px-4 py-3 bg-secondary/20"
      data-testid="fleet-process-scanner"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-primary" />
          <p className="typo-caption font-medium text-foreground">Running Claude processes</p>
          {orphans > 0 && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-interactive bg-orange-500/15 text-orange-300"
              data-testid="fleet-orphan-count"
            >
              {orphans} orphaned
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={<RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />}
          onClick={scan}
          disabled={busy}
          data-testid="fleet-scan-processes"
        >
          Scan
        </Button>
      </div>
      <p className="text-[11px] text-foreground/60 leading-relaxed mb-3">
        Claude CLI processes on this machine. Sessions Fleet still tracks are marked; the rest are
        orphans (e.g. left running after an app restart) or external — kill them here instead of
        hunting them down in Task Manager.
      </p>

      {procs === null ? (
        <div className="py-4 flex justify-center">
          <LoadingSpinner />
        </div>
      ) : procs.length === 0 ? (
        <p className="text-[11px] text-foreground/50 py-2 text-center">No Claude processes running.</p>
      ) : (
        <ul className="space-y-1" data-testid="fleet-process-list">
          {procs.map((p) => (
            <li
              key={p.pid}
              className="flex items-center gap-2 text-[11px] border border-primary/5 rounded-interactive px-2 py-1.5 bg-background/40"
              data-testid={`fleet-process-${p.pid}`}
            >
              {p.tracked ? (
                <ShieldCheck className="w-3 h-3 text-emerald-400 flex-shrink-0" />
              ) : (
                <AlertTriangle className="w-3 h-3 text-orange-400 flex-shrink-0" />
              )}
              <span className="font-mono text-foreground/80 w-14 flex-shrink-0">{p.pid}</span>
              <span className="text-foreground/70 w-14 flex-shrink-0">{fmtMem(p.memoryBytes)}</span>
              <span className="flex-1 min-w-0">
                <TruncateWithTooltip text={p.cwd ?? p.cmd} className="text-foreground/60 font-mono" />
              </span>
              <span
                className={`text-[10px] flex-shrink-0 ${p.tracked ? 'text-emerald-400' : 'text-orange-300'}`}
              >
                {p.tracked ? 'Fleet' : 'orphan'}
              </span>
              <Button
                variant="danger"
                size="xs"
                icon={<Skull className="w-3 h-3" />}
                onClick={() => setConfirm(p)}
                disabled={killing === p.pid}
                data-testid={`fleet-kill-process-${p.pid}`}
              >
                Kill
              </Button>
            </li>
          ))}
        </ul>
      )}

      {confirm && (
        <ConfirmDialog
          title="Kill process?"
          body={`End PID ${confirm.pid}${confirm.cwd ? ` (${confirm.cwd})` : ''}? Any unsaved work in that session is lost.`}
          danger
          confirmLabel="Kill"
          onConfirm={() => doKill(confirm.pid)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
