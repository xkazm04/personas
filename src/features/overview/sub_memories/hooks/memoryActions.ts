import type { MemoryReviewDetail } from '@/api/overview/memories';
import type { PersonaMemory } from '@/lib/bindings/PersonaMemory';

// ── Types ───────────────────────────────────────────────────────

export type MemoryActionKind = 'throttle' | 'schedule' | 'alert' | 'config' | 'routing';

export interface MemoryAction {
  id: string;
  memoryId: string;
  memoryTitle: string;
  kind: MemoryActionKind;
  rule: string;
  reasoning: string;
  score: number;
  agentId: string;
  dismissed: boolean;
  createdAt: string;
}

const STORAGE_KEY = 'dolla:memory-actions';

// ── Persistence (localStorage) ──────────────────────────────────

export function loadActions(): MemoryAction[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as MemoryAction[];
  } catch {
    return [];
  }
}

export function saveActions(actions: MemoryAction[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(actions));
  } catch {
    // storage full — actions still live in-memory
  }
}

// ── Rule extraction from review results ─────────────────────────

const KIND_PATTERNS: Array<{ kind: MemoryActionKind; patterns: RegExp[] }> = [
  {
    kind: 'throttle',
    patterns: [/rate.?limit/i, /throttl/i, /quota/i, /req(uest)?s?\s*\/\s*(hour|min|sec|day)/i, /too many/i, /429/i],
  },
  {
    kind: 'schedule',
    patterns: [/weekend/i, /business hours/i, /off.?hours/i, /schedule/i, /cron/i, /time.?zone/i, /maintenance.?window/i],
  },
  {
    kind: 'alert',
    patterns: [/fail/i, /error/i, /down/i, /outage/i, /alert/i, /warn/i, /degrad/i, /timeout/i],
  },
  {
    kind: 'routing',
    patterns: [/route/i, /redirect/i, /fallback/i, /alternative/i, /backup/i, /mirror/i],
  },
  {
    kind: 'config',
    patterns: [/config/i, /setting/i, /parameter/i, /default/i, /env/i, /variable/i],
  },
];

function detectKind(text: string): MemoryActionKind {
  for (const { kind, patterns } of KIND_PATTERNS) {
    if (patterns.some((p) => p.test(text))) return kind;
  }
  return 'config';
}

function extractRule(memory: PersonaMemory): string {
  const content = memory.content || memory.title;
  // Use the content directly as the rule — the memory itself is the actionable intelligence
  return content.length > 200 ? content.slice(0, 200) + '...' : content;
}

/**
 * Given a set of review details (scored memories) and the full memory list,
 * extract actionable rules from memories that scored 8+.
 */
export function extractActionsFromReview(
  details: MemoryReviewDetail[],
  memories: PersonaMemory[],
): MemoryAction[] {
  const memoryMap = new Map(memories.map((m) => [m.id, m]));
  const existing = loadActions();
  const existingIds = new Set(existing.map((a) => a.memoryId));

  const newActions: MemoryAction[] = [];

  for (const detail of details) {
    if (detail.score < 8) continue;
    if (detail.action === 'deleted') continue;
    if (existingIds.has(detail.id)) continue;

    const memory = memoryMap.get(detail.id);
    if (!memory) continue;

    // Only extract from warning/decision/insight categories that imply actionability
    const category = memory.category.toLowerCase();
    const isActionable = ['warning', 'learned', 'instruction', 'preference'].includes(category)
      || memory.importance >= 4;

    if (!isActionable) continue;

    const combined = `${memory.title} ${memory.content}`;
    const kind = detectKind(combined);
    const rule = extractRule(memory);

    newActions.push({
      id: `ma_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      memoryId: memory.id,
      memoryTitle: memory.title,
      kind,
      rule,
      reasoning: detail.reason,
      score: detail.score,
      agentId: memory.persona_id,
      dismissed: false,
      createdAt: new Date().toISOString(),
    });
  }

  return newActions;
}

// ── Kind labels & colors ────────────────────────────────────────

export const ACTION_KIND_META: Record<MemoryActionKind, { label: string; color: string; bgClass: string; borderClass: string; textClass: string }> = {
  throttle: { label: 'Throttle Rule', color: '#f59e0b', bgClass: 'bg-amber-500/10', borderClass: 'border-amber-500/20', textClass: 'text-amber-400' },
  schedule: { label: 'Schedule Adjustment', color: '#8b5cf6', bgClass: 'bg-violet-500/10', borderClass: 'border-violet-500/20', textClass: 'text-violet-400' },
  alert: { label: 'Alert Rule', color: '#f43f5e', bgClass: 'bg-rose-500/10', borderClass: 'border-rose-500/20', textClass: 'text-rose-400' },
  config: { label: 'Config Change', color: '#06b6d4', bgClass: 'bg-cyan-500/10', borderClass: 'border-cyan-500/20', textClass: 'text-cyan-400' },
  routing: { label: 'Routing Rule', color: '#10b981', bgClass: 'bg-emerald-500/10', borderClass: 'border-emerald-500/20', textClass: 'text-emerald-400' },
};
