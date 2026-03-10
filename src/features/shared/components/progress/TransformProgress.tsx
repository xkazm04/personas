import { useMemo } from 'react';
import type { TransformProgressProps } from './transformProgressTypes';
import { detectTransformPhase, detectAnalysisPhase } from './phaseDetection';
import { AnalysisModeView } from './AnalysisModeView';
import { TransformModeView } from './TransformModeView';

export type { TransformProgressProps };

export function TransformProgress({
  lines,
  mode = 'transform',
  phase = 'idle',
  runId,
  isRestoring,
  onRetry,
  onCancel,
  errorMessage,
  isRunning = false,
}: TransformProgressProps) {
  const transformPhase = useMemo(
    () => (mode === 'transform' && (phase === 'running' || phase === 'completed') ? detectTransformPhase(lines, phase) : null),
    [lines, phase, mode],
  );

  const analysisPhase = useMemo(
    () => (mode === 'analysis' && isRunning ? detectAnalysisPhase(lines) : null),
    [lines, isRunning, mode],
  );

  if (mode === 'analysis') {
    return (
      <AnalysisModeView
        lines={lines}
        isRunning={isRunning}
        analysisPhase={analysisPhase}
      />
    );
  }

  return (
    <TransformModeView
      lines={lines}
      phase={phase}
      runId={runId}
      isRestoring={isRestoring}
      onRetry={onRetry}
      onCancel={onCancel}
      errorMessage={errorMessage}
      transformPhase={transformPhase}
    />
  );
}
