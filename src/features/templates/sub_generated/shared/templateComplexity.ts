import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { AgentIR, ProtocolCapability, AdoptionRequirement, AdoptionQuestion } from '@/lib/types/designTypes';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import { parseJsonOrDefault as parseJsonSafe } from '@/lib/utils/parseJson';

// -- Difficulty levels ------------------------------------------------

export type DifficultyLevel = 'beginner' | 'intermediate' | 'advanced';

export interface DifficultyMeta {
  label: string;
  color: string;
  bgClass: string;
}

export const DIFFICULTY_META: Record<DifficultyLevel, DifficultyMeta> = {
  beginner:     { label: 'Beginner',     color: '#22c55e', bgClass: 'bg-emerald-500/10 text-emerald-400/80 border-emerald-500/20' },
  intermediate: { label: 'Intermediate', color: '#f59e0b', bgClass: 'bg-amber-500/10 text-amber-400/80 border-amber-500/20' },
  advanced:     { label: 'Advanced',     color: '#ef4444', bgClass: 'bg-red-500/10 text-red-400/80 border-red-500/20' },
};

// -- Setup time levels ------------------------------------------------

export type SetupLevel = 'quick' | 'moderate' | 'involved';

export interface SetupMeta {
  label: string;
  minutes: number;
  color: string;
  bgClass: string;
}

export const SETUP_META: Record<SetupLevel, SetupMeta> = {
  quick:    { label: 'Quick Setup',    minutes: 5,  color: '#22c55e', bgClass: 'bg-emerald-500/10 text-emerald-400/80 border-emerald-500/20' },
  moderate: { label: 'Moderate Setup', minutes: 15, color: '#f59e0b', bgClass: 'bg-amber-500/10 text-amber-400/80 border-amber-500/20' },
  involved: { label: 'Involved Setup', minutes: 30, color: '#ef4444', bgClass: 'bg-red-500/10 text-red-400/80 border-red-500/20' },
};

// -- Internal: extract rich fields from design_result -----------------

interface ComplexitySignals {
  connectorCount: number;
  flowCount: number;
  triggerCount: number;
  requiredVariableCount: number;
  adoptionQuestionCount: number;
  hasHumanReview: boolean;
  hasMemory: boolean;
  hasWebhook: boolean;
  hasPolling: boolean;
}

function extractSignals(review: PersonaDesignReview): ComplexitySignals {
  const connectors: string[] = parseJsonSafe(review.connectors_used, []);
  const flows: UseCaseFlow[] = parseJsonSafe(review.use_case_flows, []);
  const triggerTypes: string[] = parseJsonSafe(review.trigger_types, []);
  const designResult = parseJsonSafe<AgentIR | null>(review.design_result, null);

  const capabilities: ProtocolCapability[] = designResult?.protocol_capabilities ?? [];
  const requirements: AdoptionRequirement[] = designResult?.adoption_requirements ?? [];
  const questions: AdoptionQuestion[] = designResult?.adoption_questions ?? [];

  return {
    connectorCount: connectors.length,
    flowCount: flows.length,
    triggerCount: triggerTypes.length,
    requiredVariableCount: requirements.filter(r => r.required).length,
    adoptionQuestionCount: questions.length,
    hasHumanReview: capabilities.some(c => c.type === 'manual_review'),
    hasMemory: capabilities.some(c => c.type === 'agent_memory'),
    hasWebhook: triggerTypes.includes('webhook'),
    hasPolling: triggerTypes.includes('polling'),
  };
}

/**
 * Compute difficulty from template attributes:
 *   - connector count
 *   - flow / trigger count
 *   - required variables (adoption requirements)
 *   - adoption questions
 *   - human-review protocol
 *   - memory scope
 *
 * Uses a weighted score so each dimension contributes proportionally.
 */
export function computeDifficulty(review: PersonaDesignReview): DifficultyLevel {
  const s = extractSignals(review);

  // Weighted complexity score (0 .. ~20+)
  let score = 0;
  score += Math.min(s.connectorCount, 6) * 2;        // 0-12
  score += Math.min(s.flowCount, 6);                  // 0-6
  score += Math.min(s.triggerCount, 4);                // 0-4
  score += Math.min(s.requiredVariableCount, 5);       // 0-5
  score += Math.min(s.adoptionQuestionCount, 4) * 0.5; // 0-2
  if (s.hasHumanReview) score += 3;
  if (s.hasMemory) score += 2;

  if (score >= 12) return 'advanced';
  if (score >= 5)  return 'intermediate';
  return 'beginner';
}

/**
 * Compute setup level and estimated minutes from template attributes.
 *
 * Heuristic time budget per component:
 *   - Each connector credential: ~3 min
 *   - Each required variable: ~1 min
 *   - Webhook/polling trigger: +3 min
 *   - Human review config: +2 min
 *   - Memory config: +2 min
 *   - Base overhead: 2 min
 *
 * Bucketed to nearest friendly value (5, 10, 15, 20, 30).
 */
export function computeSetupLevel(review: PersonaDesignReview): SetupLevel {
  const s = extractSignals(review);
  const minutes = estimateSetupMinutes(review);

  // Also check structural complexity for the level
  const hasComplexTriggers = s.hasWebhook || s.hasPolling;

  if (minutes >= 20 || s.connectorCount >= 4 || (s.connectorCount >= 3 && hasComplexTriggers)) {
    return 'involved';
  }
  if (minutes >= 8 || s.connectorCount >= 2 || hasComplexTriggers) {
    return 'moderate';
  }
  return 'quick';
}

/** Estimate setup time in minutes from template attributes. */
export function estimateSetupMinutes(review: PersonaDesignReview): number {
  const s = extractSignals(review);

  let minutes = 2; // base overhead
  minutes += s.connectorCount * 3;
  minutes += s.requiredVariableCount * 1;
  if (s.hasWebhook) minutes += 3;
  if (s.hasPolling) minutes += 2;
  if (s.hasHumanReview) minutes += 2;
  if (s.hasMemory) minutes += 2;

  // Snap to friendly values
  if (minutes <= 5) return 5;
  if (minutes <= 10) return 10;
  if (minutes <= 15) return 15;
  if (minutes <= 20) return 20;
  return 30;
}

/** All difficulty levels for filter dropdowns */
export const DIFFICULTY_OPTIONS: { value: DifficultyLevel; label: string }[] = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
];

/** All setup levels for filter dropdowns */
export const SETUP_OPTIONS: { value: SetupLevel; label: string }[] = [
  { value: 'quick', label: 'Quick Setup' },
  { value: 'moderate', label: 'Moderate Setup' },
  { value: 'involved', label: 'Involved Setup' },
];
