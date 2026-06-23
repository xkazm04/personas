// Turns a golden-standard scan finding (DevStandard) into a Claude-Code fix.
// Findings describe the REPO's actual compliance ("formatter absent", "temp
// artifacts committed", "CLAUDE.md is boilerplate") — repo-state issues whose fix
// is a code change, not a policy toggle. So each open finding becomes a "Fix with
// Claude" task whose prompt IS the finding's recommendation. (The instant Tier-0
// policy toggles have their own entry on the CI/Security/Self-verify cells.)
import type { DevStandard } from '@/lib/bindings/DevStandard';
import type { AppPassport } from '../passportModel';
import { stackLine } from './deployActions';

/** The Claude-fix prompt for a finding — the recommendation IS the spec. */
export function findingPrompt(f: DevStandard, passport: AppPassport): string {
  return [
    'Address this golden-standard gap in the repository:',
    '',
    `• ${f.title}`,
    f.recommendation ? `Recommendation: ${f.recommendation}` : '',
    f.evidence ? `Evidence in the repo: ${f.evidence}` : '',
    '',
    stackLine(passport),
    'Read the codebase, implement the fix idiomatically for this stack, keep the change minimal and non-destructive, and verify it works before finishing.',
  ].filter(Boolean).join('\n');
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, warn: 1, info: 2 };

/** Open findings (not already present), worst severity first. */
export function openFindings(findings: DevStandard[]): DevStandard[] {
  return findings
    .filter((f) => f.status !== 'present')
    .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3));
}

/** 0–100 compliance across all scanned rules. */
export function compliancePct(findings: DevStandard[]): number | null {
  if (findings.length === 0) return null;
  const weight: Record<string, number> = { present: 1, partial: 0.5, missing: 0 };
  const sum = findings.reduce((acc, f) => acc + (weight[f.status] ?? 0), 0);
  return Math.round((sum / findings.length) * 100);
}
