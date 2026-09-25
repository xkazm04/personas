import { describe, expect, it, vi } from 'vitest';
import { chunkGap, decodeChunk, onRemoteSessionOutput, publishRemoteSessionOutput } from '../remoteSessionOutput';

describe('remote session output tail', () => {
  it('counts skipped chunks between two seqs; the first chunk is never a gap', () => {
    expect(chunkGap(null, 17)).toBe(0);
    expect(chunkGap(4, 5)).toBe(0);
    expect(chunkGap(4, 8)).toBe(3);
    expect(chunkGap(8, 4)).toBe(0);
  });

  it('decodes base64 to the raw bytes, UTF-8 intact', () => {
    const bytes = decodeChunk(btoa(String.fromCharCode(...new TextEncoder().encode('ok ✓'))));
    expect(new TextDecoder().decode(bytes)).toBe('ok ✓');
  });

  it('fans a chunk out to listeners until they unsubscribe', () => {
    const l = vi.fn();
    const off = onRemoteSessionOutput(l);
    publishRemoteSessionOutput({ jobId: 'j', seq: 1, chunkB64: '' });
    off();
    publishRemoteSessionOutput({ jobId: 'j', seq: 2, chunkB64: '' });
    expect(l).toHaveBeenCalledTimes(1);
  });
});
