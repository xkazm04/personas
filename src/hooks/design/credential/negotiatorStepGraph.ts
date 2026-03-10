/**
 * negotiatorStepGraph — replaces linear step traversal with a lightweight
 * directed graph where edges have predicates.  The negotiator evaluates
 * predicates at each node to determine the next step, skipping irrelevant
 * branches (e.g. OAuth when API key exists, capture when autoCred filled
 * values, verify when no healthcheck config).
 */
import type { NegotiationStep } from './useCredentialNegotiator';

// ── Runtime context for predicate evaluation ──────────────────────

export interface StepGraphContext {
  /** Values already captured by autoCred or manual entry */
  prefilledValues: Record<string, string>;
  /** Whether the connector uses OAuth (non-null oauth_type) */
  hasOAuth: boolean;
  /** Whether all required field keys already have values */
  allFieldsPrefilled: boolean;
  /** Whether the connector has a healthcheck endpoint */
  hasHealthcheck: boolean;
}

// ── Graph types ───────────────────────────────────────────────────

export interface StepNode {
  /** Original index in the plan's step array */
  originalIndex: number;
  step: NegotiationStep;
  /** Whether this node is skipped given the current context */
  skipped: boolean;
  /** Reason the step was skipped (for UI display) */
  skipReason: string | null;
}

type SkipPredicate = (step: NegotiationStep, ctx: StepGraphContext) => string | null;

// ── Skip predicates ──────────────────────────────────────────────
// Each returns a human-readable skip reason, or null if the step is active.

const SKIP_PREDICATES: SkipPredicate[] = [
  // Skip OAuth/authorize steps when connector doesn't use OAuth
  (step, ctx) => {
    if (step.action_type !== 'authorize') return null;
    if (!ctx.hasOAuth) return 'No OAuth required — API key authentication';
    return null;
  },

  // Skip capture steps when autoCred already filled all field values
  (step, ctx) => {
    if (step.action_type !== 'capture' || !step.field_fills) return null;
    const keys = Object.keys(step.field_fills);
    if (keys.length === 0) return null;
    const allFilled = keys.every((k) => ctx.prefilledValues[k]?.trim());
    return allFilled ? 'Values already captured by auto-credential' : null;
  },

  // Skip verify steps when connector has no healthcheck config
  (step, ctx) => {
    if (step.action_type !== 'verify') return null;
    if (!ctx.hasHealthcheck) return 'No health check configured for this connector';
    return null;
  },

  // Skip account creation steps when any field is already prefilled
  // (user likely already has an account)
  (step, ctx) => {
    if (step.action_type !== 'create_account') return null;
    if (ctx.allFieldsPrefilled) return 'Account credentials already available';
    return null;
  },
];

// ── Graph builder ────────────────────────────────────────────────

/**
 * Build a step graph from a flat step array, evaluating skip predicates
 * against the provided runtime context.
 */
export function buildStepGraph(
  steps: NegotiationStep[],
  ctx: StepGraphContext,
): StepNode[] {
  return steps.map((step, i) => {
    let skipReason: string | null = null;
    for (const predicate of SKIP_PREDICATES) {
      skipReason = predicate(step, ctx);
      if (skipReason) break;
    }
    return {
      originalIndex: i,
      step,
      skipped: skipReason !== null,
      skipReason,
    };
  });
}

// ── Resolved view ────────────────────────────────────────────────

export interface ResolvedSteps {
  /** Only the steps that should be shown to the user */
  visible: StepNode[];
  /** Steps that were skipped with reasons */
  skipped: StepNode[];
  /** Map from visible index → original plan index */
  visibleToOriginal: number[];
  /** Map from original plan index → visible index (or -1 if skipped) */
  originalToVisible: Map<number, number>;
}

/**
 * Resolve which steps are visible vs skipped.  Returns bidirectional
 * index mappings so the UI can translate between visible positions and
 * original plan indices.
 */
export function resolveSteps(nodes: StepNode[]): ResolvedSteps {
  const visible: StepNode[] = [];
  const skipped: StepNode[] = [];
  const visibleToOriginal: number[] = [];
  const originalToVisible = new Map<number, number>();

  for (const node of nodes) {
    if (node.skipped) {
      skipped.push(node);
      originalToVisible.set(node.originalIndex, -1);
    } else {
      originalToVisible.set(node.originalIndex, visible.length);
      visibleToOriginal.push(node.originalIndex);
      visible.push(node);
    }
  }

  return { visible, skipped, visibleToOriginal, originalToVisible };
}

/**
 * Convenience: build + resolve in one call.
 */
export function resolveStepGraph(
  steps: NegotiationStep[],
  ctx: StepGraphContext,
): ResolvedSteps {
  return resolveSteps(buildStepGraph(steps, ctx));
}
