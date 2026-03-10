import { useState, useEffect, useRef } from 'react';
import type { PhaseEntry } from '../runnerTypes';
import { detectPhaseFromLine, PHASE_META } from '../runnerTypes';

/**
 * Derives execution phases from terminal output lines for the breadcrumb timeline.
 */
export function usePhaseTracker(
  outputLines: string[],
  elapsedMs: number,
  isExecuting: boolean,
  personaId: string,
) {
  const [phases, setPhases] = useState<PhaseEntry[]>([]);
  const [showPhases, setShowPhases] = useState(true);
  const phaseLineCount = useRef(0);
  const hasSeenToolsRef = useRef(false);

  // Derive phases from new output lines
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

  // Reset phase tracking when a new execution starts
  useEffect(() => {
    if (isExecuting) {
      setPhases([]);
      phaseLineCount.current = 0;
      hasSeenToolsRef.current = false;
    }
  }, [isExecuting]);

  // Reset phase tracking when persona changes
  useEffect(() => {
    setPhases([]);
    phaseLineCount.current = 0;
    hasSeenToolsRef.current = false;
  }, [personaId]);

  return { phases, showPhases, setShowPhases };
}
