// Provenance — the "why does it say this?" for a dimension. Each line is grounded
// in the actual signals the derive read (context count, standards flags, bound
// credentials, detected tables), so a rating is auditable instead of magic. Shown
// in the cell popover above the ladder/actions; also feeds the exported report.
import type { ImproveRaw } from './ImproveContext';
import { parseStandards } from './standards';

export function dimensionReason(rowKey: string, raw: ImproveRaw): string | null {
  const { meta, project } = raw;
  const std = parseStandards(project.standards_config);
  const tables = meta.db_tables?.length ?? 0;
  switch (rowKey) {
    case 'context':
      return `${meta.context_count} contexts mapped${meta.context_count >= 20 ? ' — full graph' : meta.context_count >= 5 ? ' — partial' : ' — sparse'}. Re-scan to map more of the repo.`;
    case 'ci': {
      const gates = [
        std.precommit.lint && 'lint',
        std.precommit.code_quality && 'type/quality',
        std.branching.pr_base && 'PR-gated',
        std.branching.automerge.enabled && 'automerge',
      ].filter(Boolean);
      return gates.length ? `From the standards policy: ${gates.join(', ')}.` : 'No branching or check policy is set.';
    }
    case 'tests':
      return 'No automated test signal detected — wire a suite an agent can self-verify against.';
    case 'security':
      return project.standards_config
        ? 'Standards policy present, but no dependency/code scanning detected.'
        : 'No security policy or scanning detected.';
    case 'observability':
    case 'errors':
    case 'logs':
    case 'metrics':
    case 'tracing':
      return project.monitoring_credential_id ? 'A monitoring connector is bound.' : 'No monitoring connector is bound.';
    case 'llmtracking':
      return project.llm_tracking_credential_id
        ? 'An LLM-observability connector is bound.'
        : 'No LLM-tracking connector bound (Langfuse / Helicone / LangSmith / …).';
    case 'evals':
      return 'No evaluation harness detected.';
    case 'migrations':
      return tables > 0 ? `${tables} tables detected, no versioned migrations.` : 'No database / migrations detected.';
    case 'instructions':
      return project.team_id ? 'Team policy provides agent guidance.' : 'No CLAUDE.md / agent instructions detected.';
    case 'aiflow':
      return project.pr_credential_id || project.auto_pr_on_success ? 'PR automation is wired.' : 'No automated PR / team pipeline wired.';
    case 'skills':
      return raw.hasSkills ? 'Reusable skills present in .claude/skills.' : 'No reusable skills installed.';
    case 'selfverify':
      return 'Self-verify reflects the precommit policy + detected build tooling.';
    default:
      return null;
  }
}
