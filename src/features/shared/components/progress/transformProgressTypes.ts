import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';

export type PhaseIconComponent = React.ComponentType<{ className?: string }>;

export interface TransformPhaseInfo {
  step: number;
  total: number;
  label: string;
  Icon: PhaseIconComponent;
}

export interface AnalysisPhaseInfo {
  step: number;
  total: number;
  label: string;
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
