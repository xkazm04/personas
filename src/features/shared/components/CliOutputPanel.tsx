import { lazy, Suspense, type ReactNode } from 'react';
import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';
import { TerminalHeader } from '@/features/shared/components/TerminalHeader';
import { classifyLine, TERMINAL_STYLE_MAP } from '@/lib/utils/terminalColors';
import { useCopyToClipboard } from '@/hooks/utility/useCopyToClipboard';
<<<<<<< HEAD
import type { CliOperation } from '@/features/settings/sub_engine/libs/engineCapabilities';

const EngineCapabilityBadge = lazy(() =>
  import('@/features/settings/sub_engine/components/EngineCapabilityBadge').then(m => ({ default: m.EngineCapabilityBadge }))
=======
import type { CliOperation } from '@/features/settings/sub_engine/engineCapabilities';

const EngineCapabilityBadge = lazy(() =>
  import('@/features/settings/sub_engine/EngineCapabilityBadge').then(m => ({ default: m.EngineCapabilityBadge }))
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
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
  /** CLI operation type — shows capability warning banner when engine is not verified */
  operation?: CliOperation;
}

export default function CliOutputPanel({
  phase,
  runId,
  lines,
  idleText = 'No CLI output yet.',
  waitingText = 'Waiting for Claude CLI output…',
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

      <div className={`${maxHeightClassName} overflow-y-auto px-4 py-3 font-mono text-sm leading-5 space-y-0.5`}>
        {phase === 'idle' && lines.length === 0 ? (
          <div className="text-muted-foreground/80 text-center py-4">{idleText}</div>
        ) : lines.length === 0 ? (
          <div className="text-muted-foreground/80 text-center py-4">{waitingText}</div>
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
          <div className="text-muted-foreground/80 animate-pulse">{'>'} _</div>
        )}
      </div>
    </div>
  );
}
