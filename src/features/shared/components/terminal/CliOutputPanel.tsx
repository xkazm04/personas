import { type ReactNode } from 'react';
import { isCliRunSettled, type CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';
import { TerminalHeader } from '@/features/shared/components/terminal/TerminalHeader';
import { TerminalBody } from '@/features/shared/components/terminal/TerminalBody';
import { useCopyToClipboard } from '@/hooks/utility/interaction/useCopyToClipboard';

interface CliOutputPanelProps {
  title?: string;
  phase: CliRunPhase;
  runId?: string | null;
  lines: string[];
  idleText?: string;
  waitingText?: string;
  /**
   * Shown when the run has settled (completed / failed / cancelled /
   * incomplete / unknown) without ever producing a line. Without it the panel
   * sat on `waitingText` forever for a run that had already stopped.
   */
  settledText?: string;
  maxHeightClassName?: string;
  /** Optional TerminalStrip rendered below the header for healing/background processes */
  healingStrip?: ReactNode;
}

export default function CliOutputPanel({
  phase,
  runId,
  lines,
  idleText = 'No CLI output yet.',
  waitingText = 'Waiting for Claude CLI output...',
  settledText = 'The run ended without producing any output.',
  maxHeightClassName = 'max-h-64',
  healingStrip,
}: CliOutputPanelProps) {
  const { copied, copy: copyToClipboard } = useCopyToClipboard();

  const handleCopy = () => copyToClipboard(lines.join('\n'));

  // `queued` deliberately does not count as running: nothing is executing
  // yet, so the blinking cursor would be claiming output that cannot arrive.
  const isRunning = phase === 'running';
  const isSettled = isCliRunSettled(phase);

  return (
    <div className="mt-3 rounded-xl border border-border/30 overflow-hidden bg-background shadow-[0_0_30px_rgba(0,0,0,0.3)]">
      <TerminalHeader
        isRunning={isRunning}
        lineCount={lines.length}
        onCopy={handleCopy}
        copied={copied}
        label={runId ? runId.slice(0, 8) : undefined}
      />

      {healingStrip}

      {lines.length === 0 ? (
        <div className={`${maxHeightClassName} overflow-y-auto px-4 py-3 typo-code leading-5`}>
          {phase === 'idle' ? (
            <div className="text-foreground text-center py-4">{idleText}</div>
          ) : isSettled ? (
            <div className="text-foreground text-center py-4">{settledText}</div>
          ) : (
            <div className="text-foreground text-center py-4">{waitingText}</div>
          )}
          {isRunning && (
            <div className="text-foreground animate-pulse">{'>'} _</div>
          )}
        </div>
      ) : (
        <TerminalBody
          lines={lines}
          isRunning={isRunning}
          showCursor={isRunning}
          maxHeightClass={maxHeightClassName}
        />
      )}
    </div>
  );
}
