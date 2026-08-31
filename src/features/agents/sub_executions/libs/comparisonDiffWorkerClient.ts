import { diffLines, jsonDiff } from './comparisonHelpers';

export type LineDiffEntry = { type: 'same' | 'added' | 'removed'; text: string };
export type JsonDiffEntry = { path: string; left: string; right: string };

type WorkerRequest =
  | { id: number; kind: 'line'; left: string | null; right: string | null; chunkSize: number }
  | { id: number; kind: 'json'; left: string | null; right: string | null };

type WorkerResponse =
  | { id: number; kind: 'line-chunk'; chunk: LineDiffEntry[] }
  | { id: number; kind: 'line-complete'; result: LineDiffEntry[] }
  | { id: number; kind: 'json-complete'; result: JsonDiffEntry[] }
  | { id: number; kind: 'error'; error: string };

type PendingLine = {
  onChunk: (chunk: LineDiffEntry[]) => void;
  resolve: (result: LineDiffEntry[]) => void;
  reject: (error: Error) => void;
};

type PendingJson = {
  resolve: (result: JsonDiffEntry[]) => void;
  reject: (error: Error) => void;
};

const lineCache = new Map<string, LineDiffEntry[]>();
const jsonCache = new Map<string, JsonDiffEntry[]>();
const pendingLine = new Map<number, PendingLine>();
const pendingJson = new Map<number, PendingJson>();

let worker: Worker | null | undefined;
let nextRequestId = 1;

/**
 * Max cached diff results per kind. Long-session hygiene: these caches were
 * unbounded and keyed by a hash of the compared payloads, so a session that
 * compares many execution pairs over a few days accumulated full
 * LineDiffEntry[]/JsonDiffEntry[] arrays forever. Modeled on
 * `fleetTerminalManager`'s MAX_PARKED/MAX_WEBGL discipline (bounded LRU + an
 * eviction counter): a cap set too low and "comparisons feel slow to
 * recompute" would otherwise read identically without the counter.
 */
const MAX_CACHE_ENTRIES = 24;

let lineCacheEvictions = 0;
let jsonCacheEvictions = 0;

/** Test-only / diagnostic accessor for the eviction counters. */
export function __getComparisonCacheStats(): {
  lineSize: number;
  jsonSize: number;
  lineEvictions: number;
  jsonEvictions: number;
} {
  return {
    lineSize: lineCache.size,
    jsonSize: jsonCache.size,
    lineEvictions: lineCacheEvictions,
    jsonEvictions: jsonCacheEvictions,
  };
}

/** Test-only: clear both caches and reset the eviction counters. */
export function __resetComparisonCachesForTests(): void {
  lineCache.clear();
  jsonCache.clear();
  lineCacheEvictions = 0;
  jsonCacheEvictions = 0;
}

/** Read `key`, touching it to the most-recently-used end on a hit. */
function lruGet<V>(cache: Map<string, V>, key: string): V | undefined {
  const value = cache.get(key);
  if (value !== undefined) {
    cache.delete(key);
    cache.set(key, value);
  }
  return value;
}

/** Write `key`, evicting the least-recently-used entry past the cap. */
function lruSet<V>(cache: Map<string, V>, key: string, value: V, onEvict: () => void): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey: string | undefined = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
    onEvict();
  }
}

function hashContent(value: string | null): string {
  const text = value ?? '';
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}

function diffCacheKey(left: string | null, right: string | null): string {
  return `${hashContent(left)}-${hashContent(right)}`;
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  if (typeof Worker === 'undefined') {
    worker = null;
    return worker;
  }

  try {
    worker = new Worker(new URL('../workers/comparisonDiff.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.kind === 'line-chunk') {
        pendingLine.get(message.id)?.onChunk(message.chunk);
        return;
      }
      if (message.kind === 'line-complete') {
        const pending = pendingLine.get(message.id);
        if (!pending) return;
        pendingLine.delete(message.id);
        pending.resolve(message.result);
        return;
      }
      if (message.kind === 'json-complete') {
        const pending = pendingJson.get(message.id);
        if (!pending) return;
        pendingJson.delete(message.id);
        pending.resolve(message.result);
        return;
      }

      const error = new Error(message.error);
      const line = pendingLine.get(message.id);
      if (line) {
        pendingLine.delete(message.id);
        line.reject(error);
      }
      const json = pendingJson.get(message.id);
      if (json) {
        pendingJson.delete(message.id);
        json.reject(error);
      }
    };
    worker.onerror = (event) => {
      const reason =
        event instanceof ErrorEvent && event.message
          ? event.message
          : 'comparison diff worker crashed';
      const error = new Error(reason);
      for (const [id, pending] of pendingLine) {
        pendingLine.delete(id);
        pending.reject(error);
      }
      for (const [id, pending] of pendingJson) {
        pendingJson.delete(id);
        pending.reject(error);
      }
      worker?.terminate();
      worker = undefined;
    };
  } catch {
    worker = null;
  }
  return worker;
}

export function computeLineDiffOffThread(
  left: string | null,
  right: string | null,
  onChunk: (chunk: LineDiffEntry[]) => void,
): { cancel: () => void; promise: Promise<LineDiffEntry[]> } {
  const key = diffCacheKey(left, right);
  const cached = lruGet(lineCache, key);
  if (cached) {
    let cancelled = false;
    return {
      cancel: () => {
        cancelled = true;
      },
      promise: new Promise((resolve) => {
        queueMicrotask(() => {
          if (cancelled) return;
          onChunk(cached);
          resolve(cached);
        });
      }),
    };
  }

  const activeWorker = getWorker();
  if (!activeWorker) {
    const result = diffLines(
      (left ?? '').split('\n').filter((line) => line.trim()),
      (right ?? '').split('\n').filter((line) => line.trim()),
    );
    lruSet(lineCache, key, result, () => lineCacheEvictions++);
    queueMicrotask(() => onChunk(result));
    return { cancel: () => undefined, promise: Promise.resolve(result) };
  }

  const id = nextRequestId++;
  const promise = new Promise<LineDiffEntry[]>((resolve, reject) => {
    pendingLine.set(id, {
      onChunk,
      resolve: (result) => {
        lruSet(lineCache, key, result, () => lineCacheEvictions++);
        resolve(result);
      },
      reject,
    });
  });

  const request: WorkerRequest = { id, kind: 'line', left, right, chunkSize: 50 };
  activeWorker.postMessage(request);

  return {
    cancel: () => pendingLine.delete(id),
    promise,
  };
}

export function computeJsonDiffOffThread(
  left: string | null,
  right: string | null,
): { cancel: () => void; promise: Promise<JsonDiffEntry[]> } {
  const key = diffCacheKey(left, right);
  const cached = lruGet(jsonCache, key);
  if (cached) {
    return { cancel: () => undefined, promise: Promise.resolve(cached) };
  }

  const activeWorker = getWorker();
  if (!activeWorker) {
    const result = jsonDiff(left, right);
    lruSet(jsonCache, key, result, () => jsonCacheEvictions++);
    return { cancel: () => undefined, promise: Promise.resolve(result) };
  }

  const id = nextRequestId++;
  const promise = new Promise<JsonDiffEntry[]>((resolve, reject) => {
    pendingJson.set(id, {
      resolve: (result) => {
        lruSet(jsonCache, key, result, () => jsonCacheEvictions++);
        resolve(result);
      },
      reject,
    });
  });

  const request: WorkerRequest = { id, kind: 'json', left, right };
  activeWorker.postMessage(request);

  return {
    cancel: () => pendingJson.delete(id),
    promise,
  };
}
