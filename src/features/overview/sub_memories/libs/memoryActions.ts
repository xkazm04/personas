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
 * Retention bound on the localStorage copy.
 *
 * Every persisted `MemoryAction` carries a 200-character excerpt of a memory's
 * body (`rule`) plus the model's reasoning about it. That is the same class of
 * text as the memory itself — which already lives in plaintext SQLite on this
 * machine, so the excerpt is not a NEW exposure class and encrypting one mirror
 * of it would be theatre. What it *was* is unbounded and permanent: nothing
 * here ever dropped an entry, so a rule kept growing the blob and — the real
 * defect — **an excerpt outlived the memory it was taken from**. Delete a
 * memory, or Delete-all the store, and its body text stayed in localStorage
 * forever with nothing left in the app that could show or clear it.
 *
 * So the copy is bounded in both directions: nothing older than
 * `ACTION_TTL_MS`, and never more than `MAX_PERSISTED_ACTIONS` of them,
 * newest first. Pruning runs on every read AND every write, so a session that
 * only reads still shrinks a blob left over by an older build.
 */
export const ACTION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const MAX_PERSISTED_ACTIONS = 50;

/**
 * Drop expired entries and cap the rest, newest first. Exported for the unit
 * test — a retention rule nothing exercises is a retention rule that silently
 * stops running.
 */
export function pruneActions(actions: MemoryAction[], now: number = Date.now()): MemoryAction[] {
  return actions
    .filter((a) => {
      const created = Date.parse(a.createdAt);
      // An unparseable timestamp cannot be aged out, and keeping it forever is
      // exactly the failure this bound exists to stop — treat it as expired.
      if (Number.isNaN(created)) return false;
      return now - created < ACTION_TTL_MS;
    })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, MAX_PERSISTED_ACTIONS);
}

/**
 * In-memory mirror of the last successful load. Acts as a session-scoped
 * backup so a mid-session corruption of `localStorage[STORAGE_KEY]` (truncation,
 * manual edit, quota eviction) doesn't discard the rules the user has already
 * seen in this session. `saveActions` keeps it in sync.
 */
let _sessionBackup: MemoryAction[] = [];
let _hasReportedCorruption = false;

export function loadActions(): MemoryAction[] {
  let raw: string | null;
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
    // The parsed blob is whatever a previous build (or a hand edit) left in
    // localStorage; `MemoryAction[]` is the shape this module writes and the
    // only shape `pruneActions` reads (it touches `createdAt` alone, and
    // tolerates a missing/unparseable one by expiring the entry).
    const pruned = pruneActions(parsed as MemoryAction[]);
    _sessionBackup = pruned;
    // Write back only when pruning actually removed something, so a read never
    // costs a serialize on the common path but a stale oversized blob left by
    // an older build shrinks on the next load rather than surviving forever.
    if (pruned.length !== parsed.length) saveActions(pruned);
    return pruned;
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
  const bounded = pruneActions(actions);
  _sessionBackup = bounded;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(bounded)); }
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
