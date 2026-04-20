import type { MemoryReviewDetail } from '@/api/overview/memories';
import type { PersonaMemory } from '@/lib/bindings/PersonaMemory';
import { silentCatch, toastCatch } from '@/lib/silentCatch';

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

/**
 * In-memory mirror of the last successful load. Acts as a session-scoped
 * backup so a mid-session corruption of `localStorage[STORAGE_KEY]` (truncation,
 * manual edit, quota eviction) doesn't discard the rules the user has already
 * seen in this session. `saveActions` keeps it in sync.
 */
let _sessionBackup: MemoryAction[] = [];
let _hasReportedCorruption = false;

export function loadActions(): MemoryAction[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    // Storage access denied (private mode, disabled cookies, etc.) — no user
    // toast, but route to Sentry so we know how common this is.
    silentCatch('memoryActions:loadActions:getItem')(err);
    return [..._sessionBackup];
  }
  if (!raw) return [..._sessionBackup];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      // Shape-guard — legitimately treat "not an array" as corruption so
      // later callers don't iterate on a non-iterable.
      throw new Error(`expected array, got ${typeof parsed}`);
    }
    _sessionBackup = parsed as MemoryAction[];
    return parsed as MemoryAction[];
  } catch (err) {
    // Hard data-loss path: report once per session and prefer the in-memory
    // backup over silently wiping the user's rules.
    if (!_hasReportedCorruption) {
      _hasReportedCorruption = true;
      toastCatch(
        'memoryActions:loadActions:parse',
        _sessionBackup.length > 0
          ? 'Your saved memory-action rules could not be read and were restored from this session.'
          : 'Your saved memory-action rules could not be read and may need to be re-created.',
      )(err);
    } else {
      silentCatch('memoryActions:loadActions:parse')(err);
    }
    return [..._sessionBackup];
  }
}

export function saveActions(actions: MemoryAction[]): void {
  _sessionBackup = actions.slice();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(actions)); }
  catch (err) {
    // Quota exceeded or storage disabled — not a data-loss bug (the in-memory
    // backup still holds the rules), but Sentry should see it.
    silentCatch('memoryActions:saveActions')(err);
  }
}

const KIND_PATTERNS: Array<{ kind: MemoryActionKind; patterns: RegExp[] }> = [
  { kind: 'throttle', patterns: [/rate.?limit/i, /throttl/i, /quota/i, /req(uest)?s?\s*\/\s*(hour|min|sec|day)/i, /too many/i, /429/i] },
  { kind: 'schedule', patterns: [/weekend/i, /business hours/i, /off.?hours/i, /schedule/i, /cron/i, /time.?zone/i, /maintenance.?window/i] },
  { kind: 'alert', patterns: [/fail/i, /error/i, /down/i, /outage/i, /alert/i, /warn/i, /degrad/i, /timeout/i] },
  { kind: 'routing', patterns: [/route/i, /redirect/i, /fallback/i, /alternative/i, /backup/i, /mirror/i] },
  { kind: 'config', patterns: [/config/i, /setting/i, /parameter/i, /default/i, /env/i, /variable/i] },
];

function detectKind(text: string): MemoryActionKind {
  for (const { kind, patterns } of KIND_PATTERNS) {
    if (patterns.some((p) => p.test(text))) return kind;
  }
  return 'config';
}

function extractRule(memory: PersonaMemory): string {
  const content = memory.content || memory.title;
  return content.length > 200 ? content.slice(0, 200) + '...' : content;
}

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
    const category = memory.category.toLowerCase();
    const isActionable = ['warning', 'learned', 'instruction', 'preference'].includes(category) || memory.importance >= 4;
    if (!isActionable) continue;
    const combined = `${memory.title} ${memory.content}`;
    newActions.push({
      id: `ma_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      memoryId: memory.id, memoryTitle: memory.title,
      kind: detectKind(combined), rule: extractRule(memory),
      reasoning: detail.reason, score: detail.score, agentId: memory.persona_id,
      dismissed: false, createdAt: new Date().toISOString(),
    });
  }
  return newActions;
}

export const ACTION_KIND_META: Record<MemoryActionKind, { label: string; color: string; bgClass: string; borderClass: string; textClass: string }> = {
  throttle: { label: 'Throttle Rule', color: '#f59e0b', bgClass: 'bg-amber-500/10', borderClass: 'border-amber-500/20', textClass: 'text-amber-400' },
  schedule: { label: 'Schedule Adjustment', color: '#8b5cf6', bgClass: 'bg-violet-500/10', borderClass: 'border-violet-500/20', textClass: 'text-violet-400' },
  alert: { label: 'Alert Rule', color: '#f43f5e', bgClass: 'bg-rose-500/10', borderClass: 'border-rose-500/20', textClass: 'text-rose-400' },
  config: { label: 'Config Change', color: '#06b6d4', bgClass: 'bg-cyan-500/10', borderClass: 'border-cyan-500/20', textClass: 'text-cyan-400' },
  routing: { label: 'Routing Rule', color: '#10b981', bgClass: 'bg-emerald-500/10', borderClass: 'border-emerald-500/20', textClass: 'text-emerald-400' },
};
