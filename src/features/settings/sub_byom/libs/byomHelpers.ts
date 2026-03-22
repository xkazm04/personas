import type { CliEngine } from '@/lib/types/types';
import type { TaskComplexity } from '@/api/system/byom';

export const PROVIDER_OPTIONS: { id: CliEngine; label: string }[] = [
  { id: 'claude_code', label: 'Claude Code' },
  { id: 'codex_cli', label: 'Codex CLI' },
];

export const COMPLEXITY_OPTIONS: { id: TaskComplexity; label: string; description: string }[] = [
  { id: 'simple', label: 'Simple', description: 'Formatting, linting, small edits' },
  { id: 'standard', label: 'Standard', description: 'Feature implementation, refactoring' },
  { id: 'critical', label: 'Critical', description: 'Architecture changes, security work' },
];

export const ENGINE_LABELS: Record<string, string> = {
  claude_code: 'Claude Code',
  codex_cli: 'Codex CLI',
};
