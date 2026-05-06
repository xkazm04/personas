import type { EngineKind } from '@/lib/bindings/EngineKind';
import type { TaskComplexity, ByomPolicy } from '@/api/system/byom';

// The provider IDs come from the Rust-generated EngineKind binding. The label
// map is intentionally exhaustive, so tsc fails if Rust adds/removes a variant
// without updating the BYOM UI metadata.
export interface ProviderOption {
  id: EngineKind;
  label: string;
}

const ENGINE_LABELS_BY_KIND = {
  claude_code: 'Claude Code',
} satisfies Record<EngineKind, string>;

export const PROVIDER_OPTIONS: ProviderOption[] = (
  Object.entries(ENGINE_LABELS_BY_KIND) as [EngineKind, string][]
).map(([id, label]) => ({ id, label }));

const KNOWN_PROVIDERS = new Set<string>(PROVIDER_OPTIONS.map((p) => p.id));

const COMPLEXITY_LABELS_BY_KIND = {
  simple: { label: 'Simple', description: 'Formatting, linting, small edits' },
  standard: { label: 'Standard', description: 'Feature implementation, refactoring' },
  critical: { label: 'Critical', description: 'Architecture changes, security work' },
} satisfies Record<TaskComplexity, { label: string; description: string }>;

export const COMPLEXITY_OPTIONS: { id: TaskComplexity; label: string; description: string }[] = (
  Object.entries(COMPLEXITY_LABELS_BY_KIND) as [
    TaskComplexity,
    { label: string; description: string },
  ][]
).map(([id, meta]) => ({ id, ...meta }));

/** Lookup map derived from Rust-generated EngineKind values. */
export const ENGINE_LABELS: Record<string, string> = ENGINE_LABELS_BY_KIND;

// =============================================================================
// Inline policy validation (mirrors ByomPolicy::validate() in byom.rs)
// =============================================================================

export type PolicyWarningSeverity = 'error' | 'warning' | 'info';

export interface PolicyWarning {
  /** Severity of this warning */
  severity: PolicyWarningSeverity;
  /** 'routing', 'compliance', or 'top_level' (issues with allowed/blocked provider arrays themselves) */
  ruleType: 'routing' | 'compliance' | 'top_level';
  /** Index of the rule within its array (for top_level warnings, the index in the offending provider array) */
  ruleIndex: number;
  /** Human-readable warning message */
  message: string;
}

/**
 * Validate a BYOM policy client-side and return per-rule warnings.
 * This mirrors the Rust `ByomPolicy::validate()` logic so warnings
 * appear instantly on every edit without an IPC round-trip.
 */
export function validateByomPolicy(policy: ByomPolicy): PolicyWarning[] {
  const warnings: PolicyWarning[] = [];
  if (!policy.enabled) return warnings;

  const allowedSet = new Set(policy.allowed_providers.filter((p) => KNOWN_PROVIDERS.has(p)));
  const blockedSet = new Set(policy.blocked_providers.filter((p) => KNOWN_PROVIDERS.has(p)));

  // Unknown entries in the deny-list are an Error: the BE evaluator silently
  // drops un-parseable entries via filter_map, so a typo (e.g. "claude-code"
  // instead of "claude_code") would make the block ineffective at execute-time.
  // Refuse the save instead of letting the bypass through. Allowed-list typos
  // remain Info; they fail closed (not allowed = blocked) and are not a security
  // regression. Mirrors ByomPolicy::validate() in src-tauri/src/engine/byom.rs.
  for (const [i, provider] of policy.blocked_providers.entries()) {
    if (!KNOWN_PROVIDERS.has(provider)) {
      warnings.push({
        severity: 'error',
        ruleType: 'top_level',
        ruleIndex: i,
        message: `Blocked providers contains unknown provider "${provider}" - it would be silently dropped and the block would not take effect (check for typos)`,
      });
    }
  }
  for (const [i, provider] of policy.allowed_providers.entries()) {
    if (!KNOWN_PROVIDERS.has(provider)) {
      warnings.push({
        severity: 'info',
        ruleType: 'top_level',
        ruleIndex: i,
        message: `Allowed providers contains unknown provider "${provider}" - it will be ignored (check for typos)`,
      });
    }
  }

  // Check compliance rules
  for (const [i, rule] of policy.compliance_rules.entries()) {
    if (!rule.enabled) continue;
    for (const provider of rule.allowed_providers) {
      if (!KNOWN_PROVIDERS.has(provider)) {
        warnings.push({
          severity: 'info',
          ruleType: 'compliance',
          ruleIndex: i,
          message: `References unknown provider "${provider}"`,
        });
      } else if (blockedSet.has(provider)) {
        warnings.push({
          severity: 'error',
          ruleType: 'compliance',
          ruleIndex: i,
          message: `Allows "${ENGINE_LABELS[provider] ?? provider}" which is explicitly blocked - the block takes precedence`,
        });
      } else if (allowedSet.size > 0 && !allowedSet.has(provider)) {
        warnings.push({
          severity: 'warning',
          ruleType: 'compliance',
          ruleIndex: i,
          message: `Allows "${ENGINE_LABELS[provider] ?? provider}" which is not in the top-level allowed list - this provider will be blocked`,
        });
      }
    }
  }

  // Check routing rules
  for (const [i, rule] of policy.routing_rules.entries()) {
    if (!rule.enabled) continue;
    const provider = rule.provider;
    if (!KNOWN_PROVIDERS.has(provider)) {
      warnings.push({
        severity: 'info',
        ruleType: 'routing',
        ruleIndex: i,
        message: `Targets unknown provider "${provider}"`,
      });
    } else if (blockedSet.has(provider)) {
      warnings.push({
        severity: 'error',
        ruleType: 'routing',
        ruleIndex: i,
        message: `Targets "${ENGINE_LABELS[provider] ?? provider}" which is explicitly blocked`,
      });
    } else if (allowedSet.size > 0 && !allowedSet.has(provider)) {
      warnings.push({
        severity: 'warning',
        ruleType: 'routing',
        ruleIndex: i,
        message: `Targets "${ENGINE_LABELS[provider] ?? provider}" which is not in the top-level allowed list`,
      });
    }
  }

  return warnings;
}
