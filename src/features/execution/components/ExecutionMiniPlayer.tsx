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
import { useReasoningTrace } from '@/hooks/execution/useReasoningTrace';
import { useExecutionSummary } from '@/hooks/execution/useExecutionSummary';
import { ExecutionSummaryCard } from '@/features/agents/sub_executions/detail/views/ExecutionSummaryCard';
import ReasoningTrace from '@/features/shared/components/layout/ReasoningTrace';

export default function ExecutionMiniPlayer() {
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

  // Structured execution trace for summary card
  const { entries: traceEntries, isLive: traceLive } = useReasoningTrace(activeExecutionId);
  const executionSummary = useExecutionSummary(traceEntries, traceLive);

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
        className={`animate-fade-slide-in w-[360px] rounded-xl border border-primary/20 bg-background/95 backdrop-blur-lg shadow-elevation-4 shadow-black/40 overflow-hidden select-none ${
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
            <Tooltip content="Stop execution">
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
          <Tooltip content={miniPlayerExpanded ? 'Collapse' : 'Expand'}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleMiniPlayerExpanded}
            >
              {miniPlayerExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            </Button>
          </Tooltip>
          <Tooltip content="Unpin mini-player">
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
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 mr-1">Background</span>
            {backgroundExecutions.map((bg) => (
              <Tooltip key={bg.executionId} content={`${bg.personaName} — ${bg.status}`}>
                <div className="relative w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0" style={{ background: `${bg.personaColor}20`, border: `1px solid ${bg.personaColor}40` }}>
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

        {/* Simple mode: progress bar during execution, summary card on completion */}
        {isSimple && isExecuting && (
          <div className="px-3 py-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-sm text-foreground/80">
                {error ? 'Something went wrong' : stageProgress.label}
              </span>
              {!error && (
                <span className="text-xs text-muted-foreground/60 font-mono tabular-nums">
                  {Math.round(stageProgress.fraction * 100)}%
                </span>
              )}
            </div>
            <div className="w-full h-1.5 rounded-full bg-secondary/50 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700 ease-out bg-blue-400"
                style={{ width: `${stageProgress.fraction * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Simple mode: structured summary card after completion */}
        {isSimple && !isExecuting && traceEntries.length > 0 && (
          <div className="px-2.5 py-2.5">
            <ExecutionSummaryCard summary={executionSummary} compact />
          </div>
        )}

        {/* Simple mode: fallback when no trace data available */}
        {isSimple && !isExecuting && traceEntries.length === 0 && (
          <div className="px-3 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-foreground/80">
                {error ? 'Failed' : 'Complete'}
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-secondary/50 overflow-hidden mt-2">
              <div
                className={`h-full rounded-full ${error ? 'bg-red-400' : 'bg-emerald-400'}`}
                style={{ width: '100%' }}
              />
            </div>
          </div>
        )}

        {/* Simple mode: expanded reasoning trace (structured event feed) */}
        {isSimple && miniPlayerExpanded && traceEntries.length > 0 && (
          <div className="border-t border-primary/5">
            <ReasoningTrace entries={traceEntries} isLive={traceLive} />
          </div>
        )}

        {/* Full mode: Pipeline stage dots */}
        {!isSimple && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-primary/5 bg-secondary/10">
          <span className="text-sm text-muted-foreground/80 uppercase tracking-wider">Pipeline</span>
          <PipelineDots trace={pipelineTrace} />
          {executionOutput.length > 0 && (
            <span className="ml-auto text-sm font-mono text-muted-foreground/80">
              {executionOutput.length} lines
            </span>
          )}
        </div>
        )}

        {/* Full mode: summary card on completion */}
        {!isSimple && !isExecuting && traceEntries.length > 0 && (
          <div className="px-2.5 py-2">
            <ExecutionSummaryCard summary={executionSummary} compact />
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
                {lastLine || (isExecuting ? 'Waiting for output...' : 'No output')}
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
                {isExecuting ? 'Waiting for output...' : 'No output'}
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
      </div>
  );
}
