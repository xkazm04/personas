import {
  FileJson,
  Settings,
  Sparkles,
  Code,
  CheckCircle2,
} from 'lucide-react';
import { isCliRunActive, type CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';
import type { PhaseIconComponent, TransformPhaseInfo, AnalysisPhaseInfo } from './transformProgressTypes';

// -- Transform mode phases (5 phases for n8n/adopt workflow) --

interface TransformPhase {
  keywords: string[];
  /** Key under `t.shared.progress_extra` - the view translates it. */
  labelKey: string;
  icon: PhaseIconComponent;
}

const TRANSFORM_PHASES: TransformPhase[] = [
  { keywords: ['parsing', 'static workflow', 'reading workflow', 'nodes found'], labelKey: 'transform_phase_parsing', icon: FileJson },
  { keywords: ['preparing', 'transformation prompt', 'building prompt', 'claude'], labelKey: 'transform_phase_preparing', icon: Settings },
  { keywords: ['generating', 'persona', 'ai is', 'processing', 'claude cli', 'thinking'], labelKey: 'transform_phase_generating', icon: Sparkles },
  { keywords: ['extracting', 'output received', 'json', 'draft', 'parsing result'], labelKey: 'transform_phase_extracting', icon: Code },
  { keywords: ['complete', 'success', 'finished', 'done', 'ready', '[v]'], labelKey: 'transform_phase_ready', icon: CheckCircle2 },
];

export function detectTransformPhase(lines: string[], streamPhase: CliRunPhase): TransformPhaseInfo | null {
  if (lines.length === 0) return null;

  let lastMatchedIndex = -1;
  // While the run is still active (queued or running) the final "ready" phase
  // is withheld -- it is only reachable once the run has actually settled.
  const maxIndex = isCliRunActive(streamPhase) ? TRANSFORM_PHASES.length - 2 : TRANSFORM_PHASES.length - 1;

  for (const line of lines) {
    const lower = line.toLowerCase();
    for (let i = Math.min(maxIndex, TRANSFORM_PHASES.length - 1); i > lastMatchedIndex; i--) {
      const phase = TRANSFORM_PHASES[i];
      if (phase && phase.keywords.some((kw) => lower.includes(kw))) {
        lastMatchedIndex = i;
        break;
      }
    }
  }

  if (lastMatchedIndex === -1) {
    return { step: 1, total: TRANSFORM_PHASES.length, labelKey: 'transform_phase_analyzing', Icon: FileJson };
  }
  const matched = TRANSFORM_PHASES[lastMatchedIndex]!;
  return { step: lastMatchedIndex + 1, total: TRANSFORM_PHASES.length, labelKey: matched.labelKey, Icon: matched.icon };
}

// -- Analysis mode phases (7 phases for design analysis) --

const ANALYSIS_PHASES = [
  { keywords: ['[system]', 'starting', 'initializing', 'design analysis started'], labelKey: 'analysis_phase_init' },
  { keywords: ['analyzing prompt', 'prompt structure', 'reading prompt', 'parsing'], labelKey: 'analysis_phase_prompt' },
  { keywords: ['identity', 'role', 'persona', 'instructions'], labelKey: 'analysis_phase_identity' },
  { keywords: ['tool', 'function', 'generating tool', 'suggest'], labelKey: 'analysis_phase_tools' },
  { keywords: ['trigger', 'event', 'schedule', 'channel', 'notification', 'connector'], labelKey: 'analysis_phase_integrations' },
  { keywords: ['feasibility', 'testing', 'validat', 'check'], labelKey: 'analysis_phase_feasibility' },
  { keywords: ['summary', 'highlight', 'finaliz', 'complete', 'finished', 'done', '[v]'], labelKey: 'analysis_phase_finalize' },
] as const;

export function detectAnalysisPhase(lines: string[]): AnalysisPhaseInfo | null {
  if (lines.length === 0) return null;

  let lastMatchedIndex = -1;
  for (const line of lines) {
    const lower = line.toLowerCase();
    for (let i = ANALYSIS_PHASES.length - 1; i > lastMatchedIndex; i--) {
      const p = ANALYSIS_PHASES[i];
      if (p && p.keywords.some((kw) => lower.includes(kw))) {
        lastMatchedIndex = i;
        break;
      }
    }
  }

  if (lastMatchedIndex === -1) return null;
  const matched = ANALYSIS_PHASES[lastMatchedIndex];
  if (!matched) return null;
  return { step: lastMatchedIndex + 1, total: ANALYSIS_PHASES.length, labelKey: matched.labelKey };
}
