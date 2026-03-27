import { useState, useEffect, useRef, useMemo } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useElapsedTimer } from '@/hooks';
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import { usePersonaExecution } from '@/hooks/execution/usePersonaExecution';
import { useAiHealingStream } from '@/hooks/execution/useAiHealingStream';
import { classifyLine, parseSummaryLine } from '@/lib/utils/terminalColors';
import type { TerminalEmptyState } from '@/features/shared/components/terminal/TerminalBody';
import { useExecutionList } from './useExecutionList';
import type { HealingEventPayload, PhaseEntry } from './runnerHelpers';
import { detectPhaseFromLine, PHASE_META } from './runnerHelpers';

const EMPTY_LINES: string[] = [];

/** How long (ms) without new output before each silence level triggers. */
const SILENCE_WAITING_MS = 60_000;
const SILENCE_STUCK_MS = 120_000;

export type SilenceLevel = 'active' | 'waiting' | 'stuck';

export function useRunnerState(personaId: string) {
  const isExecuting = useAgentStore((state) => state.isExecuting);
  const executionOutput = useAgentStore((state) => state.executionOutput);
  const executionPersonaId = useAgentStore((state) => state.executionPersonaId);
  const rerunInputData = useSystemStore((state) => state.rerunInputData);
  const setRerunInputData = useSystemStore((state) => state.setRerunInputData);
  const queuePosition = useAgentStore((s) => s.queuePosition);
  const queueDepth = useAgentStore((s) => s.queueDepth);

  const { disconnect } = usePersonaExecution();
  const elapsedMs = useElapsedTimer(isExecuting, 500);

  const isThisPersonasExecution = executionPersonaId === personaId && personaId !== '';

  // Read output directly from the store — no local copy
  const outputLines = isThisPersonasExecution ? executionOutput : EMPTY_LINES;

  // Shared execution list — provides typicalDurationMs derived from store data
  const { typicalDurationMs } = useExecutionList(personaId);

  const [inputData, setInputData] = useState('{}');
  const [showInputEditor, setShowInputEditor] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [healingNotification, setHealingNotification] = useState<HealingEventPayload | null>(null);

  // Silence / stuck detection
  const lastOutputCountRef = useRef(0);
  const lastOutputTimeRef = useRef(Date.now());
  const [silenceLevel, setSilenceLevel] = useState<SilenceLevel>('active');

  // Phase tracking
  const [phases, setPhases] = useState<PhaseEntry[]>([]);
  const [showPhases, setShowPhases] = useState(true);
  const phaseLineCount = useRef(0);
  const hasSeenToolsRef = useRef(false);

  // AI self-healing
  const aiHealing = useAiHealingStream(personaId);
  const [showHealingLog, setShowHealingLog] = useState(false);

  // Terminal state
  const [terminalHeight, setTerminalHeight] = useState(400);
  const [isTerminalFullscreen, setIsTerminalFullscreen] = useState(false);

  // Execution summary
  const executionSummary = useMemo(() => {
    for (let i = outputLines.length - 1; i >= 0; i--) {
      const line = outputLines[i]!;
      if (classifyLine(line) === 'summary') {
        const parsed = parseSummaryLine(line);
        if (parsed) return parsed;
      }
    }
    return null;
  }, [outputLines]);

  const terminalEmptyState = useMemo((): TerminalEmptyState => {
    if (!isExecuting) return 'idle';
    if (queuePosition != null) return { kind: 'queued', position: queuePosition + 1, depth: queueDepth ?? undefined };
    return 'connecting';
  }, [isExecuting, queuePosition, queueDepth]);

  // Derive phases
  useEffect(() => {
    if (outputLines.length <= phaseLineCount.current) return;
    const now = elapsedMs;
    setPhases((prev) => {
      const updated = [...prev];
      for (let i = phaseLineCount.current; i < outputLines.length; i++) {
        const line = outputLines[i]!;
        if (line.startsWith('> Using tool:')) {
          const toolName = line.replace('> Using tool:', '').trim();
          const currentPhase = updated[updated.length - 1];
          if (currentPhase) {
            const lastTool = currentPhase.toolCalls[currentPhase.toolCalls.length - 1];
            if (lastTool && lastTool.endMs === undefined) lastTool.endMs = now;
            currentPhase.toolCalls.push({ toolName, startMs: now });
          }
        }
        const detected = detectPhaseFromLine(line, hasSeenToolsRef.current);
        if (!detected) continue;
        if (detected === 'calling_tools') hasSeenToolsRef.current = true;
        const currentPhase = updated[updated.length - 1];
        if (currentPhase?.id === detected) continue;
        if (currentPhase && !currentPhase.endMs) {
          const lastTool = currentPhase.toolCalls[currentPhase.toolCalls.length - 1];
          if (lastTool && lastTool.endMs === undefined) lastTool.endMs = now;
          currentPhase.endMs = now;
        }
        updated.push({ id: detected, label: PHASE_META[detected]?.label ?? detected, startMs: now, toolCalls: [] });
      }
      return updated;
    });
    phaseLineCount.current = outputLines.length;
  }, [outputLines, elapsedMs]);

  // Track silence: update lastOutputTime when new lines arrive
  useEffect(() => {
    if (outputLines.length !== lastOutputCountRef.current) {
      lastOutputCountRef.current = outputLines.length;
      lastOutputTimeRef.current = Date.now();
      setSilenceLevel('active');
    }
  }, [outputLines]);

  // Poll silence level while executing (piggybacks on elapsedMs updates every 500ms)
  useEffect(() => {
    if (!isExecuting || !isThisPersonasExecution) {
      setSilenceLevel('active');
      return;
    }
    const gap = Date.now() - lastOutputTimeRef.current;
    if (gap >= SILENCE_STUCK_MS) setSilenceLevel('stuck');
    else if (gap >= SILENCE_WAITING_MS) setSilenceLevel('waiting');
    else setSilenceLevel('active');
  }, [isExecuting, isThisPersonasExecution, elapsedMs]);

  // Reset phases
  useEffect(() => {
    if (isExecuting) { setPhases([]); phaseLineCount.current = 0; hasSeenToolsRef.current = false; lastOutputCountRef.current = 0; lastOutputTimeRef.current = Date.now(); setSilenceLevel('active'); }
  }, [isExecuting]);

  useEffect(() => {
    setPhases([]); phaseLineCount.current = 0; hasSeenToolsRef.current = false;
  }, [personaId]);

  // Healing events
  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;
    listen<HealingEventPayload>('healing-event', (event) => {
      if (cancelled) return;
      if (event.payload.persona_id !== personaId) return;
      setHealingNotification(event.payload);
    }).then((fn) => { if (cancelled) fn(); else unlistenFn = fn; });
    return () => { cancelled = true; unlistenFn?.(); };
  }, [personaId]);

  useEffect(() => { if (isExecuting) setHealingNotification(null); }, [isExecuting]);

  // Rerun input
  const runnerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (rerunInputData !== null) {
      try { setInputData(JSON.stringify(JSON.parse(rerunInputData), null, 2)); }
      catch { setInputData(rerunInputData); }
      setShowInputEditor(true);
      setJsonError(null);
      setRerunInputData(null);
      runnerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [rerunInputData, setRerunInputData]);

  // Cleanup
  useEffect(() => () => { disconnect(); }, [disconnect]);

  return {
    inputData, setInputData, showInputEditor, setShowInputEditor,
    outputLines, jsonError, setJsonError,
    typicalDurationMs, elapsedMs, isThisPersonasExecution, silenceLevel,
    phases, showPhases, setShowPhases,
    healingNotification, setHealingNotification,
    aiHealing, showHealingLog, setShowHealingLog,
    terminalHeight, setTerminalHeight,
    isTerminalFullscreen, setIsTerminalFullscreen,
    executionSummary, terminalEmptyState,
    disconnect, runnerRef,
  };
}
