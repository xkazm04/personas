import type { CliEngine } from '@/lib/types/types';
import type { TaskComplexity, ByomPolicy } from '@/api/system/byom';

export const PROVIDER_OPTIONS: { id: CliEngine; label: string }[] = [
  { id: 'claude_code', label: 'Claude Code' },
  { id: 'codex_cli', label: 'Codex CLI' },
];

const KNOWN_PROVIDERS = new Set<string>(PROVIDER_OPTIONS.map((p) => p.id));

export const COMPLEXITY_OPTIONS: { id: TaskComplexity; label: string; description: string }[] = [
  { id: 'simple', label: 'Simple', description: 'Formatting, linting, small edits' },
  { id: 'standard', label: 'Standard', description: 'Feature implementation, refactoring' },
  { id: 'critical', label: 'Critical', description: 'Architecture changes, security work' },
];

export const ENGINE_LABELS: Record<string, string> = {
  claude_code: 'Claude Code',
  codex_cli: 'Codex CLI',
};

// =============================================================================
// Inline policy validation (mirrors ByomPolicy::validate() in byom.rs)
// =============================================================================

export interface PolicyWarning {
  /** 'routing' or 'compliance' */
  ruleType: 'routing' | 'compliance';
  /** Index of the rule within its array */
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

  // Check compliance rules
  for (const [i, rule] of policy.compliance_rules.entries()) {
    if (!rule.enabled) continue;
    for (const provider of rule.allowed_providers) {
      if (!KNOWN_PROVIDERS.has(provider)) {
        warnings.push({
          ruleType: 'compliance',
          ruleIndex: i,
          message: `References unknown provider "${provider}"`,
        });
      } else if (blockedSet.has(provider)) {
        warnings.push({
          ruleType: 'compliance',
          ruleIndex: i,
          message: `Allows "${ENGINE_LABELS[provider] ?? provider}" which is explicitly blocked — the block takes precedence`,
        });
      } else if (allowedSet.size > 0 && !allowedSet.has(provider)) {
        warnings.push({
          ruleType: 'compliance',
          ruleIndex: i,
          message: `Allows "${ENGINE_LABELS[provider] ?? provider}" which is not in the top-level allowed list — this provider will be blocked`,
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
        ruleType: 'routing',
        ruleIndex: i,
        message: `Targets unknown provider "${provider}"`,
      });
    } else if (blockedSet.has(provider)) {
      warnings.push({
        ruleType: 'routing',
        ruleIndex: i,
        message: `Targets "${ENGINE_LABELS[provider] ?? provider}" which is explicitly blocked`,
      });
    } else if (allowedSet.size > 0 && !allowedSet.has(provider)) {
      warnings.push({
        ruleType: 'routing',
        ruleIndex: i,
        message: `Targets "${ENGINE_LABELS[provider] ?? provider}" which is not in the top-level allowed list`,
      });
    }
  }

  return warnings;
}
