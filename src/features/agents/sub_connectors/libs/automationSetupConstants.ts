import type { AutomationPlatform, AutomationFallbackMode } from '@/lib/bindings/PersonaAutomation';

export const PLATFORM_TO_SERVICE_TYPE: Record<AutomationPlatform, string | null> = {
  n8n: 'n8n',
  zapier: 'zapier',
  github_actions: 'github_actions',
  custom: null,
};

export const FALLBACK_OPTIONS: Array<{ value: AutomationFallbackMode; label: string; description: string }> = [
  { value: 'connector', label: 'Fall back to agent\'s connectors', description: 'Agent uses its direct connectors if webhook fails' },
  { value: 'fail', label: 'Fail the step', description: 'Report error and stop this tool call' },
  { value: 'skip', label: 'Skip and continue', description: 'Ignore the failure and move on' },
];

export const STAGE_DEFS = [
  { label: 'Connecting', description: 'Establishing connection to AI' },
  { label: 'Analyzing requirements', description: 'Understanding what you need' },
  { label: 'Designing automation', description: 'Choosing platform and configuration' },
  { label: 'Generating workflow', description: 'Building deployable workflow definition' },
] as const;

export function deriveStageIndex(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!.toLowerCase();
    if (l.includes('design complete') || l.includes('designed successfully')) return 4;
    if (l.includes('designing automation') || l.includes('researching')) return 3;
    if (l.includes('analyzing automation') || l.includes('analyzing requirement')) return 2;
    if (l.includes('connected')) return 1;
  }
  return 0;
}

export type ModalPhase = 'idle' | 'analyzing' | 'preview' | 'deploying' | 'success' | 'error';
