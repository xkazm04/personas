import { Skull, ShieldCheck, AlertTriangle, RotateCw } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { TruncateWithTooltip } from '@/features/shared/components/display/TruncateWithTooltip';
import type { FleetDetectedProcess } from '@/lib/bindings/FleetDetectedProcess';

function fmtMem(bytes: bigint): string {
  const mb = Number(bytes) / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
}

interface FleetProcessRowProps {
  proc: FleetDetectedProcess;
  killing: boolean;
  resuming: boolean;
  onKill: () => void;
  onResume: () => void;
}

/**
 * One detected Claude process. Fleet-tracked rows are display-only; orphans
 * get **Resume** (re-adopt the conversation via `claude --resume`, when a cwd
 * is known) and **Kill**.
 */
export function FleetProcessRow({ proc, killing, resuming, onKill, onResume }: FleetProcessRowProps) {
  const { pid, cwd, cmd, memoryBytes, tracked } = proc;
  return (
    <li
      className="flex items-center gap-2 h-9 typo-body border border-primary/5 rounded-interactive px-2 bg-background/40"
      data-testid={`fleet-process-${pid}`}
    >
      {tracked ? (
        <ShieldCheck className="w-3.5 h-3.5 text-status-success flex-shrink-0" aria-hidden="true" />
      ) : (
        <AlertTriangle className="w-3.5 h-3.5 text-status-warning flex-shrink-0" aria-hidden="true" />
      )}
      <span className="typo-caption tabular-nums w-14 flex-shrink-0">{pid}</span>
      <span className="typo-caption tabular-nums w-16 flex-shrink-0 text-right">{fmtMem(memoryBytes)}</span>
      <span className="flex-1 min-w-0">
        {/* The row's one emphasis: which folder the process runs in. Pid and memory are quiet figures. */}
        <TruncateWithTooltip text={cwd ?? cmd} className="typo-title" />
      </span>
      <span className={`typo-caption flex-shrink-0 ${tracked ? 'text-status-success' : 'text-status-warning'}`}>
        {tracked ? 'Fleet' : 'orphan'}
      </span>
      {!tracked && cwd && (
        <Button
          variant="secondary"
          size="xs"
          icon={<RotateCw className="w-3 h-3" />}
          onClick={onResume}
          disabled={resuming || killing}
          data-testid={`fleet-resume-process-${pid}`}
        >
          Resume
        </Button>
      )}
      {!tracked && (
        <Button
          variant="danger"
          size="xs"
          icon={<Skull className="w-3 h-3" />}
          onClick={onKill}
          disabled={killing || resuming}
          data-testid={`fleet-kill-process-${pid}`}
        >
          Kill
        </Button>
      )}
    </li>
  );
}
