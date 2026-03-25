import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
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
  color: string;
  bgClass: string;
}

export const SETUP_META: Record<SetupLevel, SetupMeta> = {
  quick:    { label: 'Quick Setup',    color: '#22c55e', bgClass: 'bg-emerald-500/10 text-emerald-400/80 border-emerald-500/20' },
  moderate: { label: 'Moderate Setup', color: '#f59e0b', bgClass: 'bg-amber-500/10 text-amber-400/80 border-amber-500/20' },
  involved: { label: 'Involved Setup', color: '#ef4444', bgClass: 'bg-red-500/10 text-red-400/80 border-red-500/20' },
};

/**
 * Compute difficulty from connector count + flow complexity.
 * - beginner: 0-1 connectors AND <= 2 flows
 * - intermediate: 2-3 connectors OR 3-5 flows
 * - advanced: 4+ connectors OR 6+ flows
 */
export function computeDifficulty(review: PersonaDesignReview): DifficultyLevel {
  const connectors: string[] = parseJsonSafe(review.connectors_used, []);
  const flows: UseCaseFlow[] = parseJsonSafe(review.use_case_flows, []);
  const triggerTypes: string[] = parseJsonSafe(review.trigger_types, []);

  const connectorCount = connectors.length;
  const flowCount = flows.length;
  const triggerCount = triggerTypes.length;

  // Advanced: many connectors or many flows/triggers
  if (connectorCount >= 4 || flowCount >= 6 || (connectorCount >= 3 && triggerCount >= 3)) {
    return 'advanced';
  }

  // Beginner: simple templates
  if (connectorCount <= 1 && flowCount <= 2 && triggerCount <= 1) {
    return 'beginner';
  }

  return 'intermediate';
}

/**
 * Compute setup time from required credentials + data sources.
 * - quick: 0-1 connectors needing credentials
 * - moderate: 2-3 connectors needing credentials
 * - involved: 4+ connectors needing credentials or has complex triggers
 */
export function computeSetupLevel(review: PersonaDesignReview): SetupLevel {
  const connectors: string[] = parseJsonSafe(review.connectors_used, []);
  const triggerTypes: string[] = parseJsonSafe(review.trigger_types, []);

  const credentialCount = connectors.length; // each connector potentially needs setup
  const hasWebhook = triggerTypes.includes('webhook');
  const hasPolling = triggerTypes.includes('polling');

  // Involved: many credentials or complex trigger setup
  if (credentialCount >= 4 || (credentialCount >= 3 && (hasWebhook || hasPolling))) {
    return 'involved';
  }

  // Quick: minimal setup
  if (credentialCount <= 1 && !hasWebhook) {
    return 'quick';
  }

  return 'moderate';
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
