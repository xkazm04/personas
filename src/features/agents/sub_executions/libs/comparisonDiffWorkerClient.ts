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
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
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
  const cached = lineCache.get(key);
  if (cached) {
    return {
      cancel: () => undefined,
      promise: new Promise((resolve) => {
        queueMicrotask(() => {
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
    lineCache.set(key, result);
    queueMicrotask(() => onChunk(result));
    return { cancel: () => undefined, promise: Promise.resolve(result) };
  }

  const id = nextRequestId++;
  const promise = new Promise<LineDiffEntry[]>((resolve, reject) => {
    pendingLine.set(id, {
      onChunk,
      resolve: (result) => {
        lineCache.set(key, result);
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
  const cached = jsonCache.get(key);
  if (cached) {
    return { cancel: () => undefined, promise: Promise.resolve(cached) };
  }

  const activeWorker = getWorker();
  if (!activeWorker) {
    const result = jsonDiff(left, right);
    jsonCache.set(key, result);
    return { cancel: () => undefined, promise: Promise.resolve(result) };
  }

  const id = nextRequestId++;
  const promise = new Promise<JsonDiffEntry[]>((resolve, reject) => {
    pendingJson.set(id, {
      resolve: (result) => {
        jsonCache.set(key, result);
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
