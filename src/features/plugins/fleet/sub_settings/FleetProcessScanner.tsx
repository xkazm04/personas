import { useState, useEffect, useCallback } from 'react';
import { Cpu, RefreshCw } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { detectProcesses, killPid, resumeOrphan } from '@/api/fleet/fleet';
import { toastCatch, silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import type { FleetDetectedProcess } from '@/lib/bindings/FleetDetectedProcess';
import { countOrphans } from '../useFleetOrphanScan';
import { FleetProcessRow } from './FleetProcessRow';
import { FleetSettingsCard } from './FleetSettingsCard';

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
    async (target: FleetDetectedProcess) => {
      const { pid } = target;
      setKilling(pid);
      try {
        // PIDs are OS-recycled — the process captured when the confirm
        // dialog opened may no longer be the same process by the time the
        // user confirms. Re-scan and resolve the target against the LIVE
        // list before writing (the repo's "resolve against the live
        // collection" rule — see FleetGridPage's `sessions.find(... ===
        // activeSessionId)` and FleetBroadcastModal's live-prune effect);
        // a vanished/changed target aborts with a visible toast rather than
        // silently killing whatever now holds that pid.
        const fresh = await detectProcesses();
        apply(fresh);
        const stillThere = fresh.some(
          (p) => p.pid === pid && p.cmd === target.cmd && p.cwd === target.cwd,
        );
        if (!stillThere) {
          toastCatch('FleetProcessScanner:kill')(
            new Error('That process already exited — the list has been refreshed.'),
          );
          return;
        }
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
    [apply, setOrphanCount],
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
    <FleetSettingsCard
      data-testid="fleet-process-scanner"
      icon={<Cpu className="w-4 h-4 text-primary" />}
      // eslint-disable-next-line custom/no-hardcoded-jsx-text
      title="Running Claude processes"
      aside={
        <>
          {orphans > 0 && (
            <span
              className="typo-label px-1.5 py-0.5 rounded-interactive border border-status-warning/30 bg-status-warning/10 text-status-warning"
              data-testid="fleet-orphan-count"
            >
              {orphans} orphaned
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={scan}
            loading={busy}
            data-testid="fleet-scan-processes"
          >
            Scan
          </Button>
        </>
      }
      description={
        <>
          {/* eslint-disable custom/no-hardcoded-jsx-text */}
          Interactive Claude sessions on this machine. Sessions Fleet still tracks are marked; the rest
          are orphans (e.g. left running after an app restart) or external. <strong>Resume</strong>{' '}
          re-adopts the conversation, <strong>Kill</strong> ends it. No more hunting in Task Manager.
          {/* eslint-enable custom/no-hardcoded-jsx-text */}
        </>
      }
    >
      {visible === null ? (
        // Ghost rows under the card's chrome while the first scan runs.
        <div className="space-y-1" aria-busy="true">
          {[0, 1].map((i) => (
            <div key={i} aria-hidden className="h-9 rounded-interactive border border-primary/5 bg-background/40 animate-fade-in" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        // eslint-disable-next-line custom/no-hardcoded-jsx-text
        <p className="typo-caption py-2 text-center">No Claude sessions running.</p>
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
          onConfirm={() => doKill(confirm)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </FleetSettingsCard>
  );
}
