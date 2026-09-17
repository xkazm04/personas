import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';

export type PhaseIconComponent = React.ComponentType<{ className?: string }>;

/**
 * A detected phase names its label by KEY, not by text. The detectors match on
 * English CLI log lines - that is log text, not UI - but what they return has
 * to survive into fourteen locales, so the view resolves the key through `t`.
 */
export interface TransformPhaseInfo {
  step: number;
  total: number;
  /** Key under `t.shared.progress_extra`. */
  labelKey: string;
  Icon: PhaseIconComponent;
}

export interface AnalysisPhaseInfo {
  step: number;
  total: number;
  /** Key under `t.shared.progress_extra`. */
  labelKey: string;
}

export interface TransformProgressProps {
  lines: string[];
  /** 'transform' = full panel (n8n/adopt wizard). 'analysis' = compact terminal (design review). */
  mode?: 'transform' | 'analysis';
  // transform mode
  phase?: CliRunPhase;
  runId?: string | null;
  isRestoring?: boolean;
  onRetry?: () => void;
  onCancel?: () => void;
  /** Specific error message to display when phase is 'failed' */
  errorMessage?: string | null;
  // analysis mode
  isRunning?: boolean;
}
