import type { DryRunIssue } from '../types';
import type { Translations } from '@/i18n/en';

export { ConfigGlyph } from './ConfigGlyph';
export { RuntimeGlyph } from './RuntimeGlyph';
export { PolicyGlyph } from './PolicyGlyph';
export { IssueCategoryBadge } from './IssueCategoryBadge';

export type IssueCategory = 'config' | 'runtime' | 'policy';

const POLICY_PATTERNS = [
  'review',
  'approval',
  'approve',
  'policy',
  'governance',
  'compliance',
  'human',
  'escalat',
  'consent',
  'audit',
];

const RUNTIME_PATTERNS = [
  'failed',
  'failure',
  'crash',
  'panic',
  'timeout',
  'timed out',
  'rate limit',
  'rate-limit',
  'network',
  'connection',
  'error rate',
  'retry',
  'healing',
  'execution error',
  'runtime',
  'unavailable',
  'unreachable',
];

export function classifyIssueCategory(issue: Pick<DryRunIssue, 'description' | 'id'>): IssueCategory {
  if (issue.id?.startsWith('cfg_')) return 'config';

  const lower = issue.description.toLowerCase();

  for (const pat of POLICY_PATTERNS) {
    if (lower.includes(pat)) return 'policy';
  }
  for (const pat of RUNTIME_PATTERNS) {
    if (lower.includes(pat)) return 'runtime';
  }
  return 'config';
}

export function categoryLabelKey(t: Translations, category: IssueCategory): string {
  const labels = t.agents.health_issue;
  switch (category) {
    case 'config':
      return labels.category_config;
    case 'runtime':
      return labels.category_runtime;
    case 'policy':
      return labels.category_policy;
  }
}
