/**
 * Off-thread diffing for the execution comparison surface.
 *
 * IMPORT DISCIPLINE: everything this file reaches is bundled INTO the worker
 * chunk, and a worker built as IIFE inlines its dynamic imports too — so one
 * import of a module that touches the i18n layer inlines all 14 locale
 * catalogs here. That is not hypothetical: it cost 23.3 MB, 39.8% of dist's
 * JS, until 2026-09-20. Import from `../libs/comparisonDiffCore` (pure by
 * contract, graph-gated by `comparisonWorkerGraph.test.ts`) and from nothing
 * else that is not equally pure.
 */
import { jsonDiff } from '../libs/comparisonDiffCore';
import type { DiffWorkerRequest, JsonDiffEntry, LineDiffEntry } from '../libs/comparisonDiffCore';

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

self.onmessage = (event: MessageEvent<DiffWorkerRequest>) => {
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
