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
      className="flex items-center gap-2 text-[13px] border border-primary/5 rounded-interactive px-2 py-1.5 bg-background/40"
      data-testid={`fleet-process-${pid}`}
    >
      {tracked ? (
        <ShieldCheck className="w-3 h-3 text-emerald-400 flex-shrink-0" />
      ) : (
        <AlertTriangle className="w-3 h-3 text-orange-400 flex-shrink-0" />
      )}
      <span className="font-mono text-foreground/80 w-14 flex-shrink-0">{pid}</span>
      <span className="text-foreground/70 w-14 flex-shrink-0">{fmtMem(memoryBytes)}</span>
      <span className="flex-1 min-w-0">
        <TruncateWithTooltip text={cwd ?? cmd} className="text-foreground/60 font-mono" />
      </span>
      <span className={`text-[12px] flex-shrink-0 ${tracked ? 'text-emerald-400' : 'text-orange-300'}`}>
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
