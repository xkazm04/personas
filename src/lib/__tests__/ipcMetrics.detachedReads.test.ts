// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { recordIpcCall, getIpcRecords, getSlowestCalls, getGlobalSummary } from '@/lib/ipcMetrics';

// The ring is the only state the IPC panel's numbers rest on. A read hands out
// a copy of the array, but the rows are objects, so a copy of the array still
// shares every row with the ring. These tests pin that a caller writing into a
// row it was handed cannot change what the next reader computes.
// Reflect.set reports a refused write as false instead of throwing.
describe('ipcMetrics reads are detached from the ring', () => {
  it('a write into a read row does not reach the ring', () => {
    recordIpcCall({ command: 'detached_probe', durationMs: 10, ok: true, timestamp: 1 });
    const before = getGlobalSummary();

    const row = getIpcRecords().find((r) => r.command === 'detached_probe')!;
    Reflect.set(row, 'durationMs', 1_000_000);

    expect(getIpcRecords().find((r) => r.command === 'detached_probe')!.durationMs).toBe(10);
    expect(getGlobalSummary().p99).toBe(before.p99);
  });

  it('the slowest-calls read cannot rewrite the ring either', () => {
    recordIpcCall({ command: 'detached_slow', durationMs: 9_000_000, ok: true, timestamp: 2 });
    const [slowest] = getSlowestCalls(1);
    Reflect.set(slowest!, 'ok', false);

    expect(getIpcRecords().find((r) => r.command === 'detached_slow')!.ok).toBe(true);
  });

  it('the caller keeps its own input object', () => {
    const input = { command: 'detached_input', durationMs: 3, ok: true, timestamp: 3 };
    recordIpcCall(input);
    input.durationMs = 4;

    expect(Object.isFrozen(input)).toBe(false);
    expect(getIpcRecords().find((r) => r.command === 'detached_input')!.durationMs).toBe(3);
  });
});
