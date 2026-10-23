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

/** Which validator finding a warning is; the wording lives in `t.settings.byom.policy_warn_<code>`. */
export type PolicyWarningCode =
  | 'blocked_unknown_provider'
  | 'allowed_unknown_provider'
  | 'compliance_fails_open'
  | 'compliance_unknown_provider'
  | 'compliance_allows_blocked'
  | 'compliance_allows_unlisted'
  | 'routing_unknown_provider'
  | 'routing_targets_blocked'
  | 'routing_targets_unlisted';

/** Turns a finding into display text (a catalog lookup + interpolation, supplied by the caller). */
export type PolicyWarningDescriber = (code: PolicyWarningCode, params: Record<string, string>) => string;

export interface PolicyWarning {
  /** Severity of this warning */
  severity: PolicyWarningSeverity;
  /** 'routing', 'compliance', or 'top_level' (issues with allowed/blocked provider arrays themselves) */
  ruleType: 'routing' | 'compliance' | 'top_level';
  /** Index of the rule within its array (for top_level warnings, the index in the offending provider array) */
  ruleIndex: number;
  /** Which finding this is, so callers can branch on it without parsing `message`. */
  code: PolicyWarningCode;
  /** The known provider (EngineKind id) a per-provider finding is about, for chip highlighting. */
  provider?: string;
  /** Human-readable warning message, already localised by the describer passed to the validator. */
  message: string;
}

/**
 * Validate a BYOM policy client-side and return per-rule warnings.
 * This mirrors the Rust `ByomPolicy::validate()` logic so warnings
 * appear instantly on every edit without an IPC round-trip.
 */
export function validateByomPolicy(policy: ByomPolicy, describe: PolicyWarningDescriber): PolicyWarning[] {
  const warnings: PolicyWarning[] = [];
  if (!policy.enabled) return warnings;
  const label = (id: string) => ENGINE_LABELS[id] ?? id;

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
        code: 'blocked_unknown_provider',
        message: describe('blocked_unknown_provider', { provider }),
      });
    }
  }
  for (const [i, provider] of policy.allowed_providers.entries()) {
    if (!KNOWN_PROVIDERS.has(provider)) {
      warnings.push({
        severity: 'info',
        ruleType: 'top_level',
        ruleIndex: i,
        code: 'allowed_unknown_provider',
        message: describe('allowed_unknown_provider', { provider }),
      });
    }
  }

  // Check compliance rules
  for (const [i, rule] of policy.compliance_rules.entries()) {
    if (!rule.enabled) continue;
    // Partial-coverage guard, mirrors ByomPolicy::validate() in src-tauri/db/src/byom.rs:
    // a rule matches on the persona's template category, so personas without one
    // are not restricted and the control fails OPEN for them.
    if (rule.workflow_tags.length > 0) {
      warnings.push({
        severity: 'warning',
        ruleType: 'compliance',
        ruleIndex: i,
        code: 'compliance_fails_open',
        message: describe('compliance_fails_open', { name: rule.name }),
      });
    }
    for (const provider of rule.allowed_providers) {
      if (!KNOWN_PROVIDERS.has(provider)) {
        warnings.push({
          severity: 'info',
          ruleType: 'compliance',
          ruleIndex: i,
          code: 'compliance_unknown_provider',
          message: describe('compliance_unknown_provider', { provider }),
        });
      } else if (blockedSet.has(provider)) {
        warnings.push({
          severity: 'error',
          ruleType: 'compliance',
          ruleIndex: i,
          code: 'compliance_allows_blocked',
          provider,
          message: describe('compliance_allows_blocked', { provider: label(provider) }),
        });
      } else if (allowedSet.size > 0 && !allowedSet.has(provider)) {
        warnings.push({
          severity: 'warning',
          ruleType: 'compliance',
          ruleIndex: i,
          code: 'compliance_allows_unlisted',
          provider,
          message: describe('compliance_allows_unlisted', { provider: label(provider) }),
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
        code: 'routing_unknown_provider',
        message: describe('routing_unknown_provider', { provider }),
      });
    } else if (blockedSet.has(provider)) {
      warnings.push({
        severity: 'error',
        ruleType: 'routing',
        ruleIndex: i,
        code: 'routing_targets_blocked',
        provider,
        message: describe('routing_targets_blocked', { provider: label(provider) }),
      });
    } else if (allowedSet.size > 0 && !allowedSet.has(provider)) {
      warnings.push({
        severity: 'warning',
        ruleType: 'routing',
        ruleIndex: i,
        code: 'routing_targets_unlisted',
        provider,
        message: describe('routing_targets_unlisted', { provider: label(provider) }),
      });
    }
  }

  return warnings;
}
