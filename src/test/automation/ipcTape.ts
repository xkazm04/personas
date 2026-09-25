/**
 * IPC tape recorder: captures `command -> args -> response` pairs from the
 * RUNNING app so a page can be re-rendered offline, on the same data, by the
 * style page harness (`scripts/style/page-harness/`, `scripts/style/shoot.mjs`).
 *
 * Reachability: this module is imported only by `bridge.ts`, which App.tsx
 * loads behind `import.meta.env.DEV || window.__PERSONAS_TEST_MODE__`. Nothing
 * records until `tapeStart` is called over `/bridge-exec`; `tapeStop` clears
 * the tap again.
 *
 * It listens through `_setIpcTap` in `src/lib/tauriInvoke.ts`, so it sees every
 * `invokeWithTimeout` call with its args post-coercion, exactly as the
 * harness's `mockIPC` handler receives them on replay. Raw `invoke` callers are
 * not seen; wrapping `__TAURI_INTERNALS__.invoke` instead fails in the running
 * app ("Cannot redefine property: invoke"). The recorder CLI adds the boot
 * commands it issues itself.
 *
 * Tapes can carry personal data. The recorder CLI writes them under `tmp/`
 * (gitignored); never commit one.
 */
import { _setIpcTap } from "@/lib/tauriInvoke";

interface TapeEntry {
  cmd: string;
  args: unknown;
  response?: unknown;
  error?: unknown;
  ms: number;
}

const DEFAULT_MAX_ENTRIES = 5000;

let entries: TapeEntry[] = [];
let recording = false;
let maxEntries = DEFAULT_MAX_ENTRIES;
let startedAt: string | null = null;

/**
 * JSON round-trip so a later in-place mutation by the app cannot rewrite the
 * tape. BigInt (some bindings type i64 args as bigint) becomes a number; the
 * replay side normalises the same way before it compares args.
 */
function snapshot(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? Number(v) : v)));
  } catch {
    return String(value);
  }
}

function tapeStart(max?: number) {
  if (recording) return { success: true, alreadyRecording: true, count: entries.length };
  entries = [];
  maxEntries = typeof max === "number" && max > 0 ? max : DEFAULT_MAX_ENTRIES;
  startedAt = new Date().toISOString();
  recording = true;
  _setIpcTap((cmd, args, result) => {
    if (!recording || entries.length >= maxEntries) return;
    const t0 = performance.now();
    const recordedArgs = snapshot(args);
    result.then(
      (response) => {
        entries.push({ cmd, args: recordedArgs, response: snapshot(response), ms: Math.round(performance.now() - t0) });
      },
      (error) => {
        entries.push({ cmd, args: recordedArgs, error: snapshot(error), ms: Math.round(performance.now() - t0) });
      },
    );
  });
  return { success: true, startedAt };
}

function tapeStop() {
  _setIpcTap(null);
  recording = false;
  return { success: true, count: entries.length };
}

/** Page through the tape; `/bridge-exec` responses stay bounded per call. */
function tapeDump(offset?: number, limit?: number) {
  const from = Math.max(0, Number(offset) || 0);
  const size = Math.min(500, Math.max(1, Number(limit) || 100));
  return {
    success: true,
    recording,
    startedAt,
    total: entries.length,
    offset: from,
    entries: entries.slice(from, from + size),
  };
}

function tapeClear() {
  entries = [];
  return { success: true };
}

/** Called once by bridge.ts after `window.__TEST__` exists. */
export function registerIpcTape(bridge: object): void {
  Object.assign(bridge, { tapeStart, tapeStop, tapeDump, tapeClear });
}
