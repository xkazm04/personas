import type { SuggestedTrigger, ProtocolCapability } from '@/lib/types/designTypes';

// -- TRIGGER_LABELS -------------------------------------------------------

export const TRIGGER_LABELS: Record<string, string> = {
  schedule: 'Runs on a schedule', polling: 'Polls for changes', webhook: 'Listens for webhooks',
  manual: 'Manually triggered', event: 'Reacts to events',
};

// -- Extraction helpers ---------------------------------------------------

export function describeCron(cron: string): string {
  const p = cron.trim().split(/\s+/);
  if (p.length < 5) return cron;
  const [min, hour, , , dow] = p as [string, string, string, string, string];
  if (min === '*' && hour === '*') return 'Every minute';
  if (min !== '*' && hour === '*') return `Every hour at :${min.padStart(2, '0')}`;
  if (min === '0' && hour === '0') return 'Daily at midnight';
  if (min === '0' && /^\d+$/.test(hour)) return `Daily at ${hour}:00`;
  if (min === '*/5') return 'Every 5 minutes';
  if (min === '*/10') return 'Every 10 minutes';
  if (min === '*/15') return 'Every 15 minutes';
  if (min === '*/30') return 'Every 30 minutes';
  if (dow === '1-5') return `Weekdays at ${hour}:${min.padStart(2, '0')}`;
  return cron;
}

export function extractTriggers(triggers: SuggestedTrigger[]): { type: string; label: string }[] {
  return triggers.map((t) => {
    const cfg = t.config as Record<string, unknown> | undefined;
    if (t.trigger_type === 'schedule' && cfg) {
      const cron = typeof cfg.cron === 'string' ? cfg.cron : null;
      if (cron) return { type: t.trigger_type, label: describeCron(cron) };
      const interval = cfg.interval ?? cfg.every ?? cfg.frequency;
      if (typeof interval === 'string') return { type: t.trigger_type, label: `Every ${interval}` };
      if (typeof interval === 'number') return { type: t.trigger_type, label: `Every ${interval}m` };
    }
    if (t.trigger_type === 'polling' && cfg) {
      const interval = cfg.interval ?? cfg.every ?? cfg.frequency ?? cfg.poll_interval;
      if (typeof interval === 'string') return { type: t.trigger_type, label: `Poll every ${interval}` };
      if (typeof interval === 'number') return { type: t.trigger_type, label: `Poll every ${interval}m` };
    }
    if (t.description && t.description.length > 3 && t.description.length <= 45) return { type: t.trigger_type, label: t.description };
    return { type: t.trigger_type, label: TRIGGER_LABELS[t.trigger_type] ?? t.trigger_type };
  });
}

export function extractHumanReview(capabilities: ProtocolCapability[] | undefined) {
  const review = capabilities?.find((c) => c.type === 'manual_review');
  if (!review) return { level: 'none' as const, label: 'Autonomous', context: 'No human approval gates' };
  const ctx = review.context?.toLowerCase() ?? '';
  if (ctx.includes('always') || ctx.includes('required'))
    return { level: 'required' as const, label: 'Required', context: review.context || 'Approval before every action' };
  return { level: 'optional' as const, label: 'Conditional', context: review.context || 'Review on flagged items' };
}

export function extractMemory(capabilities: ProtocolCapability[] | undefined) {
  const memory = capabilities?.find((c) => c.type === 'agent_memory');
  if (!memory) return { active: false, label: 'Stateless', context: 'No cross-run memory' };
  return { active: true, label: 'Persistent', context: memory.context || 'Retains context across runs' };
}

export function extractErrorStrategies(errorHandling: string): string[] {
  if (!errorHandling) return ['Default error handling'];
  const s: string[] = [];
  const t = errorHandling.toLowerCase();
  if (t.includes('retry') || t.includes('backoff')) s.push('Retry with backoff');
  if (t.includes('timeout')) s.push('Timeout protection');
  if (t.includes('fallback') || t.includes('graceful')) s.push('Graceful fallback');
  if (t.includes('rate') && t.includes('limit')) s.push('Rate limit handling');
  if (t.includes('auth') || t.includes('credential') || t.includes('401')) s.push('Auth recovery');
  if (t.includes('log') || t.includes('report')) s.push('Error logging');
  if (t.includes('escalat') || t.includes('notify')) s.push('Escalation alerts');
  if (t.includes('skip') || t.includes('ignore')) s.push('Skip & continue');
  if (t.includes('circuit') && t.includes('break')) s.push('Circuit breaker');
  if (t.includes('idempoten')) s.push('Idempotent retries');
  return s.length > 0 ? s.slice(0, 3) : ['Default error handling'];
}

// -- Stagger reveal variants ----------------------------------------------

export const REVEAL_DELAYS: Record<string, number> = {
  // Adjacent to center cell (share grid edge)
  'connectors': 0.12,
  'human-review': 0.12,
  'messages': 0.12,
  'memory': 0.12,
  // Corner/far cells
  'use-cases': 0.24,
  'triggers': 0.24,
  'error-handling': 0.24,
  'events': 0.24,
};

export const cellRevealVariants = {
  hidden: { opacity: 0, scale: 0.92 },
  visible: (cellKey: string) => ({
    opacity: 1,
    scale: 1,
    transition: {
      delay: REVEAL_DELAYS[cellKey] ?? 0.24,
      duration: 0.36,
      ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
    },
  }),
};
