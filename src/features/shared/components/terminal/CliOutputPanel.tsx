import { lazy, Suspense, type ReactNode } from 'react';
import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';
import { TerminalHeader } from '@/features/shared/components/terminal/TerminalHeader';
import { TerminalBody } from '@/features/shared/components/terminal/TerminalBody';
import { useCopyToClipboard } from '@/hooks/utility/interaction/useCopyToClipboard';
import type { CliOperation } from '@/features/settings/sub_engine/libs/engineCapabilities';

const EngineCapabilityBadge = lazy(() =>
  import('@/features/settings/sub_engine/components/EngineCapabilityBadge').then(m => ({ default: m.EngineCapabilityBadge }))
);

interface CliOutputPanelProps {
  title?: string;
  phase: CliRunPhase;
  runId?: string | null;
  lines: string[];
  idleText?: string;
  waitingText?: string;
  maxHeightClassName?: string;
  /** Optional TerminalStrip rendered below the header for healing/background processes */
  healingStrip?: ReactNode;
  /** CLI operation type -- shows capability warning banner when engine is not verified */
  operation?: CliOperation;
}

export default function CliOutputPanel({
  phase,
  runId,
  lines,
  idleText = 'No CLI output yet.',
  waitingText = 'Waiting for Claude CLI output...',
  maxHeightClassName = 'max-h-64',
  healingStrip,
  operation,
}: CliOutputPanelProps) {
  const { copied, copy: copyToClipboard } = useCopyToClipboard();

  const handleCopy = () => copyToClipboard(lines.join('\n'));

  const isRunning = phase === 'running';

  return (
    <div className="mt-3 rounded-xl border border-border/30 overflow-hidden bg-background shadow-[0_0_30px_rgba(0,0,0,0.3)]">
      <TerminalHeader
        isRunning={isRunning}
        lineCount={lines.length}
        onCopy={handleCopy}
        copied={copied}
        label={runId ? runId.slice(0, 8) : undefined}
      />

      {operation && (
        <Suspense fallback={null}>
          <EngineCapabilityBadge operation={operation} />
        </Suspense>
      )}

      {healingStrip}

      {lines.length === 0 ? (
        <div className={`${maxHeightClassName} overflow-y-auto px-4 py-3 typo-code leading-5`}>
          {phase === 'idle' ? (
            <div className="text-muted-foreground/80 text-center py-4">{idleText}</div>
          ) : (
            <div className="text-muted-foreground/80 text-center py-4">{waitingText}</div>
          )}
          {isRunning && (
            <div className="text-muted-foreground/80 animate-pulse">{'>'} _</div>
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
