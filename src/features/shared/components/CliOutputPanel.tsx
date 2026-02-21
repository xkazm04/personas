import { useState } from 'react';
import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';
import { TerminalHeader } from '@/features/shared/components/TerminalHeader';
import { classifyLine, TERMINAL_STYLE_MAP } from '@/lib/utils/terminalColors';

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
  phase,
  runId,
  lines,
  idleText = 'No CLI output yet.',
  waitingText = 'Waiting for Claude CLI output…',
  maxHeightClassName = 'max-h-64',
}: CliOutputPanelProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isRunning = phase === 'running';

  return (
    <div className="mt-3 rounded-2xl border border-border/30 overflow-hidden bg-background shadow-[0_0_30px_rgba(0,0,0,0.3)]">
      <TerminalHeader
        isRunning={isRunning}
        lineCount={lines.length}
        onCopy={handleCopy}
        copied={copied}
        label={runId ? runId.slice(0, 8) : undefined}
      />

      <div className={`${maxHeightClassName} overflow-y-auto px-4 py-3 font-mono text-xs leading-5 space-y-0.5`}>
        {phase === 'idle' && lines.length === 0 ? (
          <div className="text-muted-foreground/30 text-center py-4">{idleText}</div>
        ) : lines.length === 0 ? (
          <div className="text-muted-foreground/30 text-center py-4">{waitingText}</div>
        ) : (
          lines.map((line, i) => {
            if (!line.trim()) return <div key={i} className="h-2" />;
            const style = classifyLine(line);
            return (
              <div key={i} className={`whitespace-pre-wrap break-words ${TERMINAL_STYLE_MAP[style]}`}>
                {line}
              </div>
            );
          })
        )}
        {isRunning && (
          <div className="text-muted-foreground/30 animate-pulse">{'>'} _</div>
        )}
      </div>
    </div>
  );
}
