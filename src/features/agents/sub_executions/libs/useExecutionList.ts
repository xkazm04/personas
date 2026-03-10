import { TEMPLATE_CATALOG } from '@/lib/personas/templates/templateCatalog';

export const TEMPLATE_SAMPLE_INPUT: Record<string, object> = {
  'gmail-maestro': { mode: 'process_inbox', max_emails: 5, labels: ['inbox', 'unread'] },
  'code-reviewer': { repo: 'owner/repo', pr_number: 42 },
  'slack-standup': { channel: '#team-standup', lookback_hours: 24 },
  'security-auditor': { target_path: './src', scan_type: 'full' },
  'doc-writer': { source_path: './src', output_format: 'markdown' },
  'test-generator': { module_path: './src/utils/helpers.ts', framework: 'vitest' },
  'dep-updater': { manifest: 'package.json', check_security: true },
  'bug-triager': { issue_id: 'BUG-1234', source: 'github' },
  'data-monitor': { pipeline: 'etl-daily', check_interval_min: 5 },
};

export function getSampleInput(personaName: string | undefined): string {
  if (!personaName) return '{}';
  const match = TEMPLATE_CATALOG.find((t) => t.name === personaName);
  const data = match ? TEMPLATE_SAMPLE_INPUT[match.id] ?? {} : {};
  return JSON.stringify(data, null, 2);
}

export function formatTokens(tokens: number): string {
  if (tokens === 0) return '-';
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
}
