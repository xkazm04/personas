import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useElapsedTimer } from '@/hooks';
import { usePersonaStore } from '@/stores/personaStore';
import { usePersonaExecution } from '@/hooks/execution/usePersonaExecution';
import { useAiHealingStream } from '@/hooks/execution/useAiHealingStream';
import { classifyLine, parseSummaryLine } from '@/lib/utils/terminalColors';
import type { TerminalEmptyState } from '@/features/shared/components/TerminalBody';
import * as api from '@/api/tauriApi';
import type { HealingEventPayload, PhaseEntry } from './runnerHelpers';
import { detectPhaseFromLine } from './runnerHelpers';

export function useRunnerState(personaId: string) {
  const isExecuting = usePersonaStore((state) => state.isExecuting);
  const executionOutput = usePersonaStore((state) => state.executionOutput);
  const executionPersonaId = usePersonaStore((state) => state.executionPersonaId);
  const rerunInputData = usePersonaStore((state) => state.rerunInputData);
  const setRerunInputData = usePersonaStore((state) => state.setRerunInputData);
  const queuePosition = usePersonaStore((s) => s.queuePosition);
  const queueDepth = usePersonaStore((s) => s.queueDepth);

  const { disconnect } = usePersonaExecution();
  const elapsedMs = useElapsedTimer(isExecuting, 500);

  const isThisPersonasExecution = executionPersonaId === personaId && personaId !== '';

  const [inputData, setInputData] = useState('{}');
  const [showInputEditor, setShowInputEditor] = useState(false);
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [typicalDurationMs, setTypicalDurationMs] = useState<number | null>(null);
  const [healingNotification, setHealingNotification] = useState<HealingEventPayload | null>(null);

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

  const fetchTypicalDuration = useCallback(async (pId: string) => {
    try {
      const execs = await api.listExecutions(pId, 20);
      const durations: number[] = execs
        .filter((e): e is typeof e & { duration_ms: number } =>
          e.status === 'completed' && typeof e.duration_ms === 'number' && e.duration_ms > 0)
        .map((e) => e.duration_ms);
      if (durations.length > 0) {
        durations.sort((a, b) => a - b);
        setTypicalDurationMs(durations[Math.floor(durations.length / 2)] ?? null);
      } else {
        setTypicalDurationMs(null);
      }
    } catch { setTypicalDurationMs(null); }
  }, []);

  // Sync store output
  useEffect(() => {
    if (isThisPersonasExecution && executionOutput.length > 0) {
      setOutputLines(executionOutput);
    } else if (!isThisPersonasExecution) {
      setOutputLines([]);
    }
  }, [executionOutput, isThisPersonasExecution]);

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
        const { PHASE_META } = require('./runnerHelpers');
        updated.push({ id: detected, label: PHASE_META[detected]?.label ?? detected, startMs: now, toolCalls: [] });
      }
      return updated;
    });
    phaseLineCount.current = outputLines.length;
  }, [outputLines, elapsedMs]);

  // Reset phases
  useEffect(() => {
    if (isExecuting) { setPhases([]); phaseLineCount.current = 0; hasSeenToolsRef.current = false; }
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
    outputLines, setOutputLines, jsonError, setJsonError,
    typicalDurationMs, elapsedMs, isThisPersonasExecution,
    phases, showPhases, setShowPhases,
    healingNotification, setHealingNotification,
    aiHealing, showHealingLog, setShowHealingLog,
    terminalHeight, setTerminalHeight,
    isTerminalFullscreen, setIsTerminalFullscreen,
    executionSummary, terminalEmptyState,
    fetchTypicalDuration, disconnect, runnerRef,
  };
}
