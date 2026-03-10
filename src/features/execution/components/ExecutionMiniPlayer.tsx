import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown,
  ChevronUp,
  Square,
  GripVertical,
  Bot,
  Timer,
  Loader2,
  CheckCircle2,
  XCircle,
  Terminal,
  PinOff,
} from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { useElapsedTimer } from '@/hooks/utility/useElapsedTimer';
import { formatElapsed } from '@/lib/utils/formatters';
import {
  PIPELINE_STAGES,
  STAGE_META,
  isPipelineStage,
  type PipelineStage,
  type UnifiedTrace,
} from '@/lib/execution/pipeline';
import { classifyLine, TERMINAL_STYLE_MAP } from '@/lib/utils/terminalColors';
import { Tooltip } from '@/features/shared/components/Tooltip';

// ── Pipeline stage dot visualisation ───────────────────────────────────

function PipelineDots({ trace }: { trace: UnifiedTrace | null }) {
  const completedStages = useMemo(() => {
    if (!trace) return new Set<PipelineStage>();
    return new Set(
      trace.spans
        .filter((s) => isPipelineStage(s.span_type))
        .map((s) => s.span_type as PipelineStage),
    );
  }, [trace]);

  const errorStages = useMemo(() => {
    if (!trace) return new Set<PipelineStage>();
    return new Set(
      trace.spans
        .filter((s) => isPipelineStage(s.span_type) && s.error)
        .map((s) => s.span_type as PipelineStage),
    );
  }, [trace]);

  return (
    <div className="flex items-center gap-1">
      {PIPELINE_STAGES.map((stage) => {
        const completed = completedStages.has(stage);
        const hasError = errorStages.has(stage);
        const pStages = trace?.spans.filter((s) => isPipelineStage(s.span_type)) ?? [];
        const lastStage = pStages[pStages.length - 1];
        const isLast =
          trace &&
          lastStage &&
          lastStage.span_type === stage &&
          !trace.completedAt;

        return (
          <Tooltip content={STAGE_META[stage].label} placement="bottom">
            <div
              key={stage}
              className={`w-2 h-2 rounded-full transition-colors ${
                hasError
                  ? 'bg-red-400'
                  : isLast
                    ? 'bg-blue-400 animate-pulse'
                    : completed
                      ? 'bg-emerald-400'
                      : 'bg-primary/15'
              }`}
            />
          </Tooltip>
        );
      })}
    </div>
  );
}

// ── Status icon ────────────────────────────────────────────────────────

function StatusIndicator({ isExecuting, hasError }: { isExecuting: boolean; hasError: boolean }) {
  if (hasError) return <XCircle className="w-4 h-4 text-red-400" />;
  if (isExecuting) return <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />;
  return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
}

// ── Main mini-player ───────────────────────────────────────────────────

export default function ExecutionMiniPlayer() {
  const miniPlayerPinned = usePersonaStore((s) => s.miniPlayerPinned);
  const miniPlayerExpanded = usePersonaStore((s) => s.miniPlayerExpanded);
  const miniPlayerPosition = usePersonaStore((s) => s.miniPlayerPosition);
  const unpinMiniPlayer = usePersonaStore((s) => s.unpinMiniPlayer);
  const toggleMiniPlayerExpanded = usePersonaStore((s) => s.toggleMiniPlayerExpanded);
  const setMiniPlayerPosition = usePersonaStore((s) => s.setMiniPlayerPosition);

  const isExecuting = usePersonaStore((s) => s.isExecuting);
  const executionOutput = usePersonaStore((s) => s.executionOutput);
  const activeExecutionId = usePersonaStore((s) => s.activeExecutionId);
  const executionPersonaId = usePersonaStore((s) => s.executionPersonaId);
  const pipelineTrace = usePersonaStore((s) => s.pipelineTrace);
  const cancelExecution = usePersonaStore((s) => s.cancelExecution);
  const personas = usePersonaStore((s) => s.personas);
  const error = usePersonaStore((s) => s.error);

  const elapsed = useElapsedTimer(isExecuting);

  // Find persona name
  const personaName = useMemo(() => {
    if (!executionPersonaId) return 'Agent';
    const p = personas.find((p) => p.id === executionPersonaId);
    return p?.name ?? 'Agent';
  }, [executionPersonaId, personas]);

  // Drag state
  const dragRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 });

  // Initialize position to bottom-right if not set
  useEffect(() => {
    if (miniPlayerPinned && miniPlayerPosition.x === -1) {
      setMiniPlayerPosition({
        x: window.innerWidth - 380,
        y: window.innerHeight - 200,
      });
    }
  }, [miniPlayerPinned, miniPlayerPosition.x, setMiniPlayerPosition]);

  // Terminal scroll ref
  const terminalRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (terminalRef.current && miniPlayerExpanded) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [executionOutput, miniPlayerExpanded]);

  // Drag handlers
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

  // Last N lines for compact view
  const lastLines = useMemo(
    () => executionOutput.slice(-30),
    [executionOutput],
  );
  const lastLine = executionOutput[executionOutput.length - 1] ?? '';

  // Show nothing when not pinned, or when there's nothing to show
  const hasContent = isExecuting || executionOutput.length > 0 || activeExecutionId;
  if (!miniPlayerPinned || !hasContent) return null;

  return (
    <AnimatePresence>
      <motion.div
        ref={dragRef}
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        style={{
          position: 'fixed',
          left: miniPlayerPosition.x,
          top: miniPlayerPosition.y,
          zIndex: 60,
        }}
        className={`w-[360px] rounded-xl border border-primary/20 bg-background/95 backdrop-blur-lg shadow-2xl shadow-black/40 overflow-hidden select-none ${
          isDragging ? 'cursor-grabbing' : ''
        }`}
      >
        {/* ── Header (draggable) ──────────────────────────────────── */}
        <div
          className="flex items-center gap-2 px-3 py-2 border-b border-primary/10 bg-secondary/30 cursor-grab active:cursor-grabbing"
          onMouseDown={handleMouseDown}
        >
          <GripVertical className="w-3.5 h-3.5 text-muted-foreground/30 flex-shrink-0" />

          <StatusIndicator isExecuting={isExecuting} hasError={!!error && !isExecuting} />

          <div className="flex-1 min-w-0 flex items-center gap-2">
            <Bot className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />
            <span className="text-sm font-medium text-foreground/80 truncate">
              {personaName}
            </span>
          </div>

          {isExecuting && (
            <div className="flex items-center gap-1 text-sm font-mono text-muted-foreground/60">
              <Timer className="w-3 h-3" />
              {formatElapsed(elapsed, 'clock')}
            </div>
          )}

          {/* Stop button */}
          {isExecuting && activeExecutionId && (
            <Tooltip content="Stop execution">
              <button
                onClick={handleStop}
                className="p-1 rounded-md hover:bg-red-500/15 text-red-400/70 hover:text-red-400 transition-colors"
              >
                <Square className="w-3 h-3" />
              </button>
            </Tooltip>
          )}

          {/* Expand/collapse */}
          <Tooltip content={miniPlayerExpanded ? 'Collapse' : 'Expand'}>
            <button
              onClick={toggleMiniPlayerExpanded}
              className="p-1 rounded-md hover:bg-secondary/50 text-muted-foreground/50 hover:text-foreground/80 transition-colors"
            >
              {miniPlayerExpanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronUp className="w-3.5 h-3.5" />
              )}
            </button>
          </Tooltip>

          {/* Unpin */}
          <Tooltip content="Unpin mini-player">
            <button
              onClick={unpinMiniPlayer}
              className="p-1 rounded-md hover:bg-secondary/50 text-muted-foreground/50 hover:text-foreground/80 transition-colors"
            >
              <PinOff className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </div>

        {/* ── Pipeline stage dots ─────────────────────────────────── */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-primary/5 bg-secondary/10">
          <span className="text-sm text-muted-foreground/60 uppercase tracking-wider">Pipeline</span>
          <PipelineDots trace={pipelineTrace} />
          {executionOutput.length > 0 && (
            <span className="ml-auto text-sm font-mono text-muted-foreground/60">
              {executionOutput.length} lines
            </span>
          )}
        </div>

        {/* ── Collapsed: single last line ─────────────────────────── */}
        {!miniPlayerExpanded && (
          <div className="px-3 py-1.5 bg-black/20">
            <div className="font-mono text-sm text-muted-foreground/50 truncate flex items-center gap-1.5">
              {isExecuting && (
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
              )}
              <span className="truncate">
                {lastLine || (isExecuting ? 'Waiting for output...' : 'No output')}
              </span>
            </div>
          </div>
        )}

        {/* ── Expanded: scrollable terminal ────────────────────────── */}
        {miniPlayerExpanded && (
          <div
            ref={terminalRef}
            className="max-h-52 overflow-y-auto bg-black/20 px-3 py-2 font-mono text-sm leading-relaxed scrollbar-thin scrollbar-thumb-primary/15 scrollbar-track-transparent"
          >
            {lastLines.length === 0 && (
              <div className="text-muted-foreground/60 flex items-center gap-2 py-2">
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
      </motion.div>
    </AnimatePresence>
  );
}
