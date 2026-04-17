/**
 * Pure helpers for IdeaScannerPage — no React dependencies.
 *
 * SCAN_MATCH_RULES: keyword patterns that map context attributes to relevant
 * scan agents. Used by matchAgentsToContext to auto-select agents based on
 * the content of a DevContext entry.
 */
import type { DevContext } from '@/lib/bindings/DevContext';
import { parseJsonArray } from '../sub_context/contextMapTypes';

/** Keyword patterns that map context attributes to relevant scan agents */
export const SCAN_MATCH_RULES: { agentKey: string; keywords: RegExp }[] = [
  { agentKey: 'code-optimizer', keywords: /performance|render|bundle|query|slow|cache|optim/i },
  { agentKey: 'security-auditor', keywords: /auth|login|token|secret|password|credential|session|encrypt|permission/i },
  { agentKey: 'architecture-analyst', keywords: /architect|module|component|layer|service|pattern|coupling|abstract/i },
  { agentKey: 'test-strategist', keywords: /test|spec|coverage|mock|assert|e2e|integration|unit/i },
  { agentKey: 'dependency-auditor', keywords: /package|dependency|import|library|version|npm|cargo/i },
  { agentKey: 'ux-reviewer', keywords: /ui|ux|component|page|view|form|modal|button|layout|style/i },
  { agentKey: 'accessibility-checker', keywords: /a11y|accessibility|aria|wcag|screen.?reader|keyboard|contrast/i },
  { agentKey: 'mobile-specialist', keywords: /mobile|responsive|viewport|touch|swipe|tablet/i },
  { agentKey: 'error-handler', keywords: /error|exception|catch|boundary|fallback|retry|toast|alert/i },
  { agentKey: 'onboarding-designer', keywords: /onboard|wizard|setup|welcome|tutorial|getting.?started/i },
  { agentKey: 'feature-scout', keywords: /feature|roadmap|missing|todo|placeholder|future/i },
  { agentKey: 'monetization-advisor', keywords: /billing|payment|subscription|plan|pricing|tier|premium/i },
  { agentKey: 'analytics-planner', keywords: /analytics|tracking|event|metric|telemetry|log/i },
  { agentKey: 'documentation-auditor', keywords: /doc|readme|comment|api.?doc|jsdoc|guide/i },
  { agentKey: 'growth-hacker', keywords: /share|referral|invite|social|viral|notification/i },
  { agentKey: 'tech-debt-tracker', keywords: /debt|legacy|workaround|hack|deprecated|fixme|todo/i },
  { agentKey: 'innovation-catalyst', keywords: /ai|ml|machine.?learn|llm|agent|automat|innovat/i },
  { agentKey: 'risk-assessor', keywords: /risk|single.?point|scale|failover|backup|disaster|recovery/i },
  { agentKey: 'integration-planner', keywords: /api|webhook|integration|sync|external|third.?party|oauth/i },
  { agentKey: 'devops-optimizer', keywords: /ci|cd|deploy|docker|pipeline|build|monitor|infra/i },
];

export function matchAgentsToContext(ctx: DevContext): string[] {
  const searchable = [
    ctx.name,
    ctx.description ?? '',
    ...parseJsonArray(ctx.keywords),
    ...parseJsonArray(ctx.tech_stack),
    ...parseJsonArray(ctx.api_surface),
    ...parseJsonArray(ctx.file_paths),
  ].join(' ');

  const matched = SCAN_MATCH_RULES
    .filter((rule) => rule.keywords.test(searchable))
    .map((rule) => rule.agentKey);

  // Always include at least architecture-analyst and code-optimizer as baseline
  if (matched.length === 0) return ['architecture-analyst', 'code-optimizer'];
  return [...new Set(matched)];
}

export function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

export const SCAN_STATUS_STYLES: Record<string, string> = {
  complete: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  running: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
  error: 'bg-red-500/15 text-red-400 border-red-500/25',
};
