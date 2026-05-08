import { jsonDiff } from '../libs/comparisonHelpers';
import type { JsonDiffEntry, LineDiffEntry } from '../libs/comparisonDiffWorkerClient';

type WorkerRequest =
  | { id: number; kind: 'line'; left: string | null; right: string | null; chunkSize: number }
  | { id: number; kind: 'json'; left: string | null; right: string | null };

function post(message: unknown) {
  self.postMessage(message);
}

function computeLineDiff(id: number, left: string | null, right: string | null, chunkSize: number) {
  const linesA = (left ?? '').split('\n').filter((line) => line.trim());
  const linesB = (right ?? '').split('\n').filter((line) => line.trim());
  const setA = new Set(linesA);
  const setB = new Set(linesB);
  const result: LineDiffEntry[] = [];
  let chunk: LineDiffEntry[] = [];

  const pushEntry = (entry: LineDiffEntry) => {
    result.push(entry);
    chunk.push(entry);
    if (chunk.length >= chunkSize) {
      post({ id, kind: 'line-chunk', chunk });
      chunk = [];
    }
  };

  for (const line of linesA) {
    pushEntry({ type: setB.has(line) ? 'same' : 'removed', text: line });
  }
  for (const line of linesB) {
    if (!setA.has(line)) {
      pushEntry({ type: 'added', text: line });
    }
  }

  if (chunk.length > 0) {
    post({ id, kind: 'line-chunk', chunk });
  }
  post({ id, kind: 'line-complete', result });
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  try {
    if (message.kind === 'line') {
      computeLineDiff(message.id, message.left, message.right, message.chunkSize);
      return;
    }

    const result: JsonDiffEntry[] = jsonDiff(message.left, message.right);
    post({ id: message.id, kind: 'json-complete', result });
  } catch (error) {
    post({
      id: message.id,
      kind: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
