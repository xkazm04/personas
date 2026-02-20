import { Terminal } from 'lucide-react';
import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';

interface CliOutputPanelProps {
  title?: string;
  phase: CliRunPhase;
  runId?: string | null;
  lines: string[];
  idleText?: string;
  waitingText?: string;
  maxHeightClassName?: string;
}

export default function CliOutputPanel({
  title = 'Claude CLI Output',
  phase,
  runId,
  lines,
  idleText = 'No CLI output yet.',
  waitingText = 'Waiting for Claude CLI output…',
  maxHeightClassName = 'max-h-64',
}: CliOutputPanelProps) {
  const phaseLabel =
    phase === 'running' ? 'Running…' : phase === 'completed' ? 'Completed' : phase === 'failed' ? 'Failed' : 'Idle';

  return (
    <div className="mt-3 rounded-lg border border-primary/10 bg-background/40 overflow-hidden">
      <div className="px-3 py-2 border-b border-primary/10 flex items-center justify-between text-[11px] text-muted-foreground/60">
        <span className="flex items-center gap-1.5">
          <Terminal className="w-3 h-3" />
          {title}
        </span>
        <span>
          {phaseLabel}
          {runId ? ` • ${runId.slice(0, 8)}` : ''}
        </span>
      </div>
      <div className={`${maxHeightClassName} overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed space-y-1`}>
        {phase === 'idle' && lines.length === 0 ? (
          <div className="text-muted-foreground/40">{idleText}</div>
        ) : lines.length === 0 ? (
          <div className="text-muted-foreground/40">{waitingText}</div>
        ) : (
          lines.map((line, index) => (
            <div key={`${index}-${line.slice(0, 24)}`} className="text-foreground/70 break-words">
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
