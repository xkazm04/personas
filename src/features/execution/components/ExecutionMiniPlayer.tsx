import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Square,
  GripVertical,
  Bot,
  Timer,
  Terminal,
  PinOff,
  Copy,
  Check,
} from 'lucide-react';
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import { useTier } from '@/hooks/utility/interaction/useTier';
import { Button } from '@/features/shared/components/buttons';
import { useElapsedTimer } from '@/hooks/utility/timing/useElapsedTimer';
import { formatElapsed } from '@/lib/utils/formatters';
import { classifyLine, TERMINAL_STYLE_MAP } from '@/lib/utils/terminalColors';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { PipelineDots, StatusIndicator } from './PipelineDots';
import { traceProgress } from '@/lib/execution/pipeline';
import { useTranslation } from '@/i18n/useTranslation';
import { useReasoningTrace } from '@/hooks/execution/useReasoningTrace';
import { useExecutionSummary } from '@/hooks/execution/useExecutionSummary';
import { ExecutionSummaryCard } from '@/features/agents/sub_executions/detail/views/ExecutionSummaryCard';
import ReasoningTrace from '@/features/shared/components/layout/ReasoningTrace';

/** Simplified execution view for Simple mode — progress bar while running, result summary when done. */
function SimpleExecutionView({ isExecuting, error, stageProgress, elapsed, executionOutput, activeExecutionId }: {
  isExecuting: boolean;
  error: string | null;
  stageProgress: { label: string; fraction: number };
  elapsed: number;
  executionOutput: string[];
  activeExecutionId: string | null;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const { entries: traceEntries, isLive: traceLive } = useReasoningTrace(activeExecutionId);
  const executionSummary = useExecutionSummary(traceEntries, traceLive);

  const resultText = useMemo(() => {
    const meaningful = executionOutput.filter((l) => l.trim().length > 0);
    return meaningful.slice(-6).join('\n');
  }, [executionOutput]);

  const handleCopy = useCallback(() => {
    const full = executionOutput.join('\n');
    navigator.clipboard.writeText(full).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [executionOutput]);

  if (isExecuting) {
    return (
      <div className="px-3 py-3 space-y-2">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-sm text-foreground/80">
            {error ? t.execution.something_went_wrong : stageProgress.label}
          </span>
          {!error && (
            <span className="text-xs text-muted-foreground/60 font-mono tabular-nums">
              {Math.round(stageProgress.fraction * 100)}%
            </span>
          )}
        </div>
        <div className="w-full h-1.5 rounded-full bg-secondary/50 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ease-out ${error ? 'bg-red-400' : 'bg-blue-400'}`}
            style={{ width: `${stageProgress.fraction * 100}%` }}
          />
        </div>
        {/* Live reasoning trace for Simple mode */}
        {traceEntries.length > 0 && (
          <div className="mt-2">
            <ReasoningTrace entries={traceEntries} isLive={traceLive} />
          </div>
        )}
      </div>
    );
  }

  // Completed state
  return (
    <div className="px-3 py-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className={`text-sm font-medium ${error ? 'text-red-400' : 'text-emerald-400'}`}>
          {error ? t.execution.failed : t.execution.complete}
        </span>
        <span className="text-xs text-muted-foreground/60 font-mono tabular-nums">
          {formatElapsed(elapsed)}
        </span>
      </div>
      {/* Structured summary card when trace data is available */}
      {executionSummary && (
        <ExecutionSummaryCard summary={executionSummary} compact />
      )}
      {resultText && !executionSummary && (
        <div className="rounded-card bg-secondary/30 border border-primary/10 p-2.5 max-h-32 overflow-y-auto">
          <p className="text-sm text-foreground/80 whitespace-pre-wrap break-words leading-relaxed">
            {resultText}
          </p>
        </div>
      )}
      {executionOutput.length > 0 && (
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-foreground/80 transition-colors"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          {copied ? t.common.copied : t.execution.copy_full_output}
        </button>
      )}
    </div>
  );
}

export default function ExecutionMiniPlayer() {
  const { t } = useTranslation();
  const { isStarter: isSimple } = useTier();
  const miniPlayerPinned = useAgentStore((s) => s.miniPlayerPinned);
  const miniPlayerExpanded = useAgentStore((s) => s.miniPlayerExpanded);
  const miniPlayerPosition = useAgentStore((s) => s.miniPlayerPosition);
  const unpinMiniPlayer = useAgentStore((s) => s.unpinMiniPlayer);
  const toggleMiniPlayerExpanded = useAgentStore((s) => s.toggleMiniPlayerExpanded);
  const setMiniPlayerPosition = useAgentStore((s) => s.setMiniPlayerPosition);

  const isExecuting = useAgentStore((s) => s.isExecuting);
  const executionOutput = useAgentStore((s) => s.executionOutput);
  const activeExecutionId = useAgentStore((s) => s.activeExecutionId);
  const executionPersonaId = useAgentStore((s) => s.executionPersonaId);
  const pipelineTrace = useAgentStore((s) => s.pipelineTrace);
  const cancelExecution = useAgentStore((s) => s.cancelExecution);
  const personas = useAgentStore((s) => s.personas);
  const error = useSystemStore((s) => s.error);

  const elapsed = useElapsedTimer(isExecuting);

  const backgroundExecutions = useAgentStore((s) => s.backgroundExecutions);

  // Structured execution trace for Power mode summary
  const { entries: traceEntries, isLive: traceLive } = useReasoningTrace(activeExecutionId);
  const executionSummary = useExecutionSummary(traceEntries, traceLive);

  const personaName = useMemo(() => {
    if (!executionPersonaId) return 'Agent';
    const p = personas.find((p) => p.id === executionPersonaId);
    return p?.name ?? 'Agent';
  }, [executionPersonaId, personas]);

  // Drag state
  const dragRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 });

  useEffect(() => {
    if (miniPlayerPinned && miniPlayerPosition.x === -1) {
      setMiniPlayerPosition({
        x: window.innerWidth - 380,
        y: window.innerHeight - 200,
      });
    }
  }, [miniPlayerPinned, miniPlayerPosition.x, setMiniPlayerPosition]);

  const terminalRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (terminalRef.current && miniPlayerExpanded) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [executionOutput, miniPlayerExpanded]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest('button')) return;
      e.preventDefault();
      setIsDragging(true);
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        posX: miniPlayerPosition.x,
        posY: miniPlayerPosition.y,
      };
    },
    [miniPlayerPosition],
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setMiniPlayerPosition({
        x: Math.max(0, Math.min(window.innerWidth - 360, dragStart.current.posX + dx)),
        y: Math.max(0, Math.min(window.innerHeight - 80, dragStart.current.posY + dy)),
      });
    };

    const handleMouseUp = () => setIsDragging(false);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, setMiniPlayerPosition]);

  const handleStop = () => {
    if (activeExecutionId) {
      cancelExecution(activeExecutionId);
    }
  };

  const lastLines = useMemo(
    () => executionOutput.slice(-30),
    [executionOutput],
  );
  const lastLine = executionOutput[executionOutput.length - 1] ?? '';

  const stageProgress = useMemo(
    () => traceProgress(pipelineTrace),
    [pipelineTrace],
  );

  const hasContent = isExecuting || executionOutput.length > 0 || activeExecutionId || backgroundExecutions.length > 0;
  if (!miniPlayerPinned || !hasContent) return null;

  return (
    <div
        ref={dragRef}
        style={{
          position: 'fixed',
          left: miniPlayerPosition.x,
          top: miniPlayerPosition.y,
          zIndex: 60,
        }}
        className={`animate-fade-slide-in w-[360px] rounded-modal border border-primary/20 bg-background/95 backdrop-blur-lg shadow-elevation-4 shadow-black/40 overflow-hidden select-none ${
          isDragging ? 'cursor-grabbing' : ''
        }`}
      >
        {/* Header (draggable) */}
        <div
          className="flex items-center gap-2 px-3 py-2 border-b border-primary/10 bg-secondary/30 cursor-grab active:cursor-grabbing"
          onMouseDown={handleMouseDown}
        >
          <GripVertical className="w-3.5 h-3.5 text-muted-foreground/60 flex-shrink-0" />
          <StatusIndicator isExecuting={isExecuting} hasError={!!error && !isExecuting} />
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <Bot className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />
            <span className="text-sm font-medium text-foreground/80 truncate">{personaName}</span>
          </div>
          {isExecuting && (
            <div className="flex items-center gap-1 text-sm font-mono text-muted-foreground/80">
              <Timer className="w-3 h-3" />
              {formatElapsed(elapsed, 'clock')}
            </div>
          )}
          {isExecuting && activeExecutionId && (
            <Tooltip content={t.execution.stop_execution}>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleStop}
                className="text-red-400/70 hover:text-red-400 hover:bg-red-500/15"
              >
                <Square className="w-3 h-3" />
              </Button>
            </Tooltip>
          )}
          {!isSimple && (
          <Tooltip content={miniPlayerExpanded ? t.execution.collapse : t.execution.expand}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleMiniPlayerExpanded}
            >
              {miniPlayerExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            </Button>
          </Tooltip>
          )}
          <Tooltip content={t.execution.unpin_mini_player}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={unpinMiniPlayer}
            >
              <PinOff className="w-3.5 h-3.5" />
            </Button>
          </Tooltip>
        </div>

        {/* Background executions bar */}
        {backgroundExecutions.length > 0 && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-primary/5 bg-secondary/10">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 mr-1">{t.execution.background}</span>
            {backgroundExecutions.map((bg) => (
              <Tooltip key={bg.executionId} content={`${bg.personaName} — ${bg.status}`}>
                <div className="relative w-5 h-5 rounded-input flex items-center justify-center flex-shrink-0" style={{ background: `${bg.personaColor}20`, border: `1px solid ${bg.personaColor}40` }}>
                  <Bot className="w-2.5 h-2.5" style={{ color: bg.personaColor }} />
                  <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-background ${
                    bg.status === 'running' ? 'bg-blue-400 animate-pulse' :
                    bg.status === 'completed' ? 'bg-emerald-400' :
                    bg.status === 'failed' ? 'bg-red-400' : 'bg-amber-400'
                  }`} />
                </div>
              </Tooltip>
            ))}
          </div>
        )}

        {/* Simple mode: friendly progress bar → result summary with reasoning trace */}
        {isSimple && (
          <SimpleExecutionView
            isExecuting={isExecuting}
            error={error}
            stageProgress={stageProgress}
            elapsed={elapsed}
            executionOutput={executionOutput}
            activeExecutionId={activeExecutionId}
          />
        )}

        {/* Full mode: Pipeline stage dots */}
        {!isSimple && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-primary/5 bg-secondary/10">
          <span className="text-sm text-muted-foreground/80 uppercase tracking-wider">{t.execution.pipeline}</span>
          <PipelineDots trace={pipelineTrace} />
          {executionOutput.length > 0 && (
            <span className="ml-auto text-sm font-mono text-muted-foreground/80">
              {executionOutput.length} {t.execution.lines}
            </span>
          )}
        </div>
        )}

        {/* Full mode: Collapsed single last line */}
        {!isSimple && !miniPlayerExpanded && (
          <div className="px-3 py-1.5 bg-black/20">
            <div className="font-mono text-sm text-muted-foreground/80 truncate flex items-center gap-1.5">
              {isExecuting && (
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
              )}
              <span className="truncate">
                {lastLine || (isExecuting ? t.execution.waiting_for_output : t.execution.no_output)}
              </span>
            </div>
          </div>
        )}

        {/* Full mode: Expanded scrollable terminal */}
        {!isSimple && miniPlayerExpanded && (
          <div
            ref={terminalRef}
            className="max-h-52 overflow-y-auto bg-black/20 px-3 py-2 font-mono text-sm leading-relaxed scrollbar-thin scrollbar-thumb-primary/15 scrollbar-track-transparent"
          >
            {lastLines.length === 0 && (
              <div className="text-muted-foreground/80 flex items-center gap-2 py-2">
                <Terminal className="w-3.5 h-3.5" />
                {isExecuting ? t.execution.waiting_for_output : t.execution.no_output}
              </div>
            )}
            {lastLines.map((line, i) => (
              <div
                key={i}
                className={`whitespace-pre-wrap break-all ${TERMINAL_STYLE_MAP[classifyLine(line)]}`}
              >
                {line}
              </div>
            ))}
            {isExecuting && (
              <div className="text-blue-400/40 animate-pulse">{'>'} _</div>
            )}
          </div>
        )}

        {/* Full mode: Execution summary when complete and trace data available */}
        {!isSimple && !isExecuting && executionSummary && (
          <div className="px-3 py-2 border-t border-primary/10">
            <ExecutionSummaryCard summary={executionSummary} compact />
          </div>
        )}
      </div>
  );
}
