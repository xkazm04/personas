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
import { diffLines, jsonDiff, splitLogLines } from '../libs/comparisonDiffCore';
import type { DiffWorkerRequest, JsonDiffEntry, LineDiffEntry } from '../libs/comparisonDiffCore';

function post(message: unknown) {
  self.postMessage(message);
}

// The algorithm is the core's `diffLines`, the same one the main-thread
// fallback runs; this file only streams its result in chunks. It used to carry
// a second hand-written copy of the Set-membership diff and of the line split.
function computeLineDiff(id: number, left: string | null, right: string | null, chunkSize: number) {
  const result: LineDiffEntry[] = diffLines(splitLogLines(left), splitLogLines(right));
  const size = Math.max(1, chunkSize);
  for (let i = 0; i < result.length; i += size) {
    post({ id, kind: 'line-chunk', chunk: result.slice(i, i + size) });
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
