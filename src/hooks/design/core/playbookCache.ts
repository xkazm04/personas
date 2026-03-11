import type { NegotiationPlan } from '../credential/useCredentialNegotiator';

export interface PlaybookRecord {
  serviceName: string;
  plan: NegotiationPlan;
  outcome: 'success' | 'fail' | 'abandoned';
  durationMs: number;
  stepsNeedingHelp: number[];
  capturedFieldCount: number;
  usedAt: string;
  usageCount: number;
}

const STORAGE_KEY = 'dolla:playbooks';

/** In-memory cache keyed by normalised service name. Bounded to prevent unbounded growth. */
const MAX_PLAYBOOK_CACHE = 100;
const cache = new Map<string, PlaybookRecord>();

function normalise(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_-]+/g, '_');
}

/** Hydrate from localStorage on first import. */
function hydrate() {
  if (cache.size > 0) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const entries: PlaybookRecord[] = JSON.parse(raw);
    for (const entry of entries) {
      cache.set(normalise(entry.serviceName), entry);
    }
  } catch {
    // corrupted data — start fresh
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...cache.values()]));
  } catch {
    // storage full or unavailable — cache still works in-memory
  }
}

hydrate();

export function lookupPlaybook(serviceName: string): PlaybookRecord | null {
  const key = normalise(serviceName);
  const record = cache.get(key);
  if (!record) return null;
  // Only return successful playbooks
  if (record.outcome !== 'success') return null;
  return record;
}

export function savePlaybook(record: PlaybookRecord): void {
  const key = normalise(record.serviceName);
  const existing = cache.get(key);

  // If we already have a successful playbook, only overwrite if new one is also successful
  if (existing?.outcome === 'success' && record.outcome !== 'success') {
    return;
  }

  const usageCount = existing ? existing.usageCount + 1 : 1;
  cache.set(key, { ...record, usageCount });
  // Evict oldest entry if cache exceeds limit
  if (cache.size > MAX_PLAYBOOK_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  persist();
}

export function markPlaybookUsed(serviceName: string): void {
  const key = normalise(serviceName);
  const record = cache.get(key);
  if (!record) return;
  record.usageCount += 1;
  record.usedAt = new Date().toISOString();
  persist();
}
