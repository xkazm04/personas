import {
  FileJson,
  Settings,
  Sparkles,
  Code,
  CheckCircle2,
} from 'lucide-react';
import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';
import type { PhaseIconComponent, TransformPhaseInfo, AnalysisPhaseInfo } from './transformProgressTypes';

// ── Transform mode phases (5 phases for n8n/adopt workflow) ──

interface TransformPhase {
  keywords: string[];
  label: string;
  icon: PhaseIconComponent;
}

const TRANSFORM_PHASES: TransformPhase[] = [
  { keywords: ['parsing', 'static workflow', 'reading workflow', 'nodes found'], label: 'Parsing workflow structure', icon: FileJson },
  { keywords: ['preparing', 'transformation prompt', 'building prompt', 'claude'], label: 'Preparing transformation', icon: Settings },
  { keywords: ['generating', 'persona', 'ai is', 'processing', 'claude cli', 'thinking'], label: 'AI generating persona draft', icon: Sparkles },
  { keywords: ['extracting', 'output received', 'json', 'draft', 'parsing result'], label: 'Extracting persona structure', icon: Code },
  { keywords: ['complete', 'success', 'finished', 'done', 'ready', '✓'], label: 'Draft ready for review', icon: CheckCircle2 },
];

export function detectTransformPhase(lines: string[], streamPhase: CliRunPhase): TransformPhaseInfo | null {
  if (lines.length === 0) return null;

  let lastMatchedIndex = -1;
  const maxIndex = streamPhase === 'running' ? TRANSFORM_PHASES.length - 2 : TRANSFORM_PHASES.length - 1;

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
    return { step: 1, total: TRANSFORM_PHASES.length, label: 'Analyzing workflow...', Icon: FileJson };
  }
  const matched = TRANSFORM_PHASES[lastMatchedIndex]!;
  return { step: lastMatchedIndex + 1, total: TRANSFORM_PHASES.length, label: matched.label, Icon: matched.icon };
}

// ── Analysis mode phases (7 phases for design analysis) ──

const ANALYSIS_PHASES = [
  { keywords: ['[system]', 'starting', 'initializing', 'design analysis started'], label: 'Initializing analysis' },
  { keywords: ['analyzing prompt', 'prompt structure', 'reading prompt', 'parsing'], label: 'Analyzing prompt structure' },
  { keywords: ['identity', 'role', 'persona', 'instructions'], label: 'Evaluating agent identity' },
  { keywords: ['tool', 'function', 'generating tool', 'suggest'], label: 'Recommending tools and triggers' },
  { keywords: ['trigger', 'event', 'schedule', 'channel', 'notification', 'connector'], label: 'Configuring integrations' },
  { keywords: ['feasibility', 'testing', 'validat', 'check'], label: 'Testing feasibility' },
  { keywords: ['summary', 'highlight', 'finaliz', 'complete', 'finished', 'done', '✓'], label: 'Finalizing design' },
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
  return { step: lastMatchedIndex + 1, total: ANALYSIS_PHASES.length, label: matched.label };
}
