import { useState, useEffect, useCallback } from 'react';
import { Cpu, RefreshCw } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { detectProcesses, killPid, resumeOrphan } from '@/api/fleet/fleet';
import { toastCatch, silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import type { FleetDetectedProcess } from '@/lib/bindings/FleetDetectedProcess';
import { countOrphans } from '../useFleetOrphanScan';
import { FleetProcessRow } from './FleetProcessRow';

/**
 * Detected-process diagnostics + orphan cleanup.
 *
 * The in-memory session registry is lost on app restart, but the `claude`
 * child processes can survive — orphans otherwise reachable only via Task
 * Manager. This scans the OS process table for *interactive* Claude sessions
 * (the app's transient `claude -p` calls are filtered out), marks which are
 * still Fleet-tracked, and lets the user **Resume** (re-adopt the conversation)
 * or **Kill** orphans. Keeps the shared `fleetOrphanCount` fresh for the
 * Settings-tab badge.
 */
export function FleetProcessScanner() {
  const [procs, setProcs] = useState<FleetDetectedProcess[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [killing, setKilling] = useState<number | null>(null);
  const [resuming, setResuming] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<FleetDetectedProcess | null>(null);
  const setOrphanCount = useSystemStore((s) => s.fleetSetOrphanCount);

  const apply = useCallback(
    (data: FleetDetectedProcess[]) => {
      setProcs(data);
      setOrphanCount(countOrphans(data));
    },
    [setOrphanCount],
  );

  const scan = useCallback(() => {
    setBusy(true);
    detectProcesses()
      .then(apply)
      .catch(silentCatch('FleetProcessScanner:scan'))
      .finally(() => setBusy(false));
  }, [apply]);

  useEffect(() => {
    scan();
  }, [scan]);

  const doKill = useCallback(
    async (pid: number) => {
      setKilling(pid);
      try {
        await killPid(pid);
        setProcs((cur) => {
          const next = cur?.filter((p) => p.pid !== pid) ?? null;
          if (next) setOrphanCount(countOrphans(next));
          return next;
        });
      } catch (e) {
        toastCatch('FleetProcessScanner:kill', 'Failed to kill process')(e);
      } finally {
        setKilling(null);
        setConfirm(null);
      }
    },
    [setOrphanCount],
  );

  const doResume = useCallback(
    async (p: FleetDetectedProcess) => {
      if (!p.cwd) return;
      setResuming(p.pid);
      try {
        await resumeOrphan(p.pid, p.cwd);
        scan(); // orphan killed + re-adopted as a tracked session — refresh.
      } catch (e) {
        toastCatch('FleetProcessScanner:resume', 'Could not resume — no transcript for that folder?')(e);
      } finally {
        setResuming(null);
      }
    },
    [scan],
  );

  // Only interactive sessions are "terminals" worth managing; the app's own
  // transient `claude -p` companion/build calls are excluded.
  const visible = procs?.filter((p) => p.interactive) ?? null;
  const orphans = visible?.filter((p) => !p.tracked).length ?? 0;

  return (
    <div
      className="border border-primary/10 rounded-modal px-4 py-3 bg-secondary/20"
      data-testid="fleet-process-scanner"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-primary" />
          {/* eslint-disable-next-line custom/no-hardcoded-jsx-text */}
          <p className="typo-caption font-medium text-foreground">Running Claude processes</p>
          {orphans > 0 && (
            <span
              className="text-[12px] px-1.5 py-0.5 rounded-interactive bg-orange-500/15 text-orange-300"
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
      {/* eslint-disable custom/no-hardcoded-jsx-text */}
      <p className="text-[13px] text-foreground leading-relaxed mb-3">
        Interactive Claude sessions on this machine. Sessions Fleet still tracks are marked; the rest
        are orphans (e.g. left running after an app restart) or external — <strong>Resume</strong>{' '}
        re-adopts the conversation, <strong>Kill</strong> ends it. No more hunting in Task Manager.
      </p>
      {/* eslint-enable custom/no-hardcoded-jsx-text */}

      {visible === null ? (
        <div className="py-4 flex justify-center">
          <LoadingSpinner />
        </div>
      ) : visible.length === 0 ? (
        // eslint-disable-next-line custom/no-hardcoded-jsx-text
        <p className="text-[13px] text-foreground py-2 text-center">No Claude sessions running.</p>
      ) : (
        <ul className="space-y-1" data-testid="fleet-process-list">
          {visible.map((p) => (
            <FleetProcessRow
              key={p.pid}
              proc={p}
              killing={killing === p.pid}
              resuming={resuming === p.pid}
              onKill={() => setConfirm(p)}
              onResume={() => doResume(p)}
            />
          ))}
        </ul>
      )}

      {confirm && (
        <ConfirmDialog
          // eslint-disable-next-line custom/no-hardcoded-jsx-text
          title="Kill process?"
          body={`End PID ${confirm.pid}${confirm.cwd ? ` (${confirm.cwd})` : ''}? Any unsaved work in that session is lost. To keep the conversation, use Resume instead.`}
          danger
          confirmLabel="Kill"
          onConfirm={() => doKill(confirm.pid)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
