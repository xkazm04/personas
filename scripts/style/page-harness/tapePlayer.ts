/**
 * Replays an IPC tape through Tauri's own `mockIPC`, so every `invoke` the page
 * makes (via `invokeWithTimeout` or raw) is answered from recorded data.
 *
 * Matching, most specific first:
 *   1. the LAST entry whose args equal the call's args (key-order independent;
 *      last, because a retried call leaves its failed first attempt earlier on
 *      the tape and the latest answer is the state the page settled on);
 *   2. an entry with no `args` field (a synthetic wildcard);
 *   3. the last entry for that command (logged as an args mismatch).
 * A command absent from the tape is logged and answered with a neutral default
 * (`[]` for list-shaped commands, `0` for counts, otherwise `null`); it never
 * throws, because an unknown command must show up in the report, not as a crash.
 */
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';

export interface TapeCall {
  cmd: string;
  /** Omit for a wildcard that answers any args. */
  args?: unknown;
  response?: unknown;
  /** When present the call rejects with this value. */
  error?: unknown;
}

export interface Tape {
  version: 1;
  module?: string;
  source: 'recorded' | 'synthetic';
  /** ISO time the data was captured at; the shooter freezes the clock here. */
  recordedAt: string;
  note?: string;
  calls: TapeCall[];
}

export interface ReplayLog {
  hits: Record<string, number>;
  unknown: Array<{ cmd: string; args: unknown; answered: unknown }>;
  argsMismatch: Array<{ cmd: string; args: unknown }>;
}

function stable(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (v === undefined || v === null) return null;
    // Recorded tapes store bigint args as numbers (ipcTape.ts snapshot).
    if (typeof v === 'bigint') return Number(v);
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[k] = walk((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return v;
  };
  try {
    return JSON.stringify(walk(value));
  } catch {
    return '"<unserializable>"';
  }
}

function neutralDefault(cmd: string): unknown {
  if (/(^|_)list(_|$)/.test(cmd) || cmd.endsWith('s_all')) return [];
  if (/(^|_)count(_|$)/.test(cmd)) return 0;
  return null;
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

export function installTape(tape: Tape, log: ReplayLog): void {
  const byCmd = new Map<string, TapeCall[]>();
  for (const call of tape.calls) {
    const list = byCmd.get(call.cmd) ?? [];
    list.push(call);
    byCmd.set(call.cmd, list);
  }

  const answer = (call: TapeCall): unknown => {
    if (call.error !== undefined) return Promise.reject(clone(call.error));
    return clone(call.response ?? null);
  };

  mockWindows('main');
  mockIPC(
    (cmd, args) => {
      log.hits[cmd] = (log.hits[cmd] ?? 0) + 1;
      const candidates = byCmd.get(cmd);
      if (!candidates || candidates.length === 0) {
        const answered = neutralDefault(cmd);
        log.unknown.push({ cmd, args: JSON.parse(stable(args ?? null)), answered });
        console.info(`[page-harness] unknown IPC command "${cmd}" answered with ${JSON.stringify(answered)}`);
        return answered;
      }
      const key = stable(args ?? null);
      const exact = [...candidates].reverse().find((c) => c.args !== undefined && stable(c.args) === key);
      if (exact) return answer(exact);
      const wildcard = candidates.find((c) => c.args === undefined);
      if (wildcard) return answer(wildcard);
      log.argsMismatch.push({ cmd, args: JSON.parse(key) });
      return answer(candidates[candidates.length - 1]!);
    },
    { shouldMockEvents: true },
  );
}
