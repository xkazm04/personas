/**
 * The worker is the path the app actually runs (jsdom has no `Worker`, so the
 * client tests only ever exercise the main-thread fallback). It must stream
 * exactly what the core's `diffLines` computes for the same input, in chunks
 * that concatenate back to the complete result.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { diffLines, splitLogLines } from '../comparisonDiffCore';
import type { DiffWorkerRequest, DiffWorkerResponse } from '../comparisonDiffCore';

const posted: DiffWorkerResponse[] = [];
const fakeSelf: { onmessage: ((e: MessageEvent<DiffWorkerRequest>) => void) | null; postMessage: (m: DiffWorkerResponse) => void } = {
  onmessage: null,
  postMessage: (m) => { posted.push(m); },
};

beforeAll(async () => {
  vi.stubGlobal('self', fakeSelf);
  await import('../../workers/comparisonDiff.worker');
});

function send(request: DiffWorkerRequest) {
  posted.length = 0;
  fakeSelf.onmessage?.({ data: request } as MessageEvent<DiffWorkerRequest>);
  return [...posted];
}

describe('comparisonDiff.worker line diff', () => {
  it('streams the core diffLines result, chunked', () => {
    const left = 'a\n\nb\nc\nrepeat\nrepeat\n  \nd';
    const right = 'b\na\nrepeat\ne\nf\ng';
    const out = send({ id: 7, kind: 'line', left, right, chunkSize: 2 });

    const expected = diffLines(splitLogLines(left), splitLogLines(right));
    const complete = out.find((m) => m.kind === 'line-complete');
    expect(complete && complete.kind === 'line-complete' ? complete.result : null).toEqual(expected);

    const chunks = out.filter((m) => m.kind === 'line-chunk');
    expect(chunks.every((m) => m.kind === 'line-chunk' && m.chunk.length <= 2)).toBe(true);
    expect(chunks.flatMap((m) => (m.kind === 'line-chunk' ? m.chunk : []))).toEqual(expected);
    expect(out[out.length - 1]?.kind).toBe('line-complete');
  });

  it('handles null sides like the fallback does', () => {
    const out = send({ id: 8, kind: 'line', left: null, right: 'x', chunkSize: 50 });
    const complete = out.find((m) => m.kind === 'line-complete');
    expect(complete && complete.kind === 'line-complete' ? complete.result : null)
      .toEqual(diffLines(splitLogLines(null), splitLogLines('x')));
  });
});
