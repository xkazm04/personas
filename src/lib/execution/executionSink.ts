/**
 * ExecutionSink -- self-contained terminal output subsystem that owns the ring
 * buffer, batching, byte budget, and flush scheduling.
 *
 * Extracted from executionSlice.ts to eliminate module-level mutable state and
 * the captured Zustand setter hack.  The execution slice holds a single sink
 * reference and delegates append/clear to it.
 */

import {
  getDocumentVisible,
  subscribeDocumentVisibility,
} from '@/lib/documentVisibility';

/** Maximum terminal output lines kept in memory to prevent OOM on long executions. */
const MAX_TERMINAL_LINES = 10_000;
/** Size of the rolling non-blank-line tail projection (mirrors the old per-consumer `.slice(-30)`). */
const MEANINGFUL_TAIL_SIZE = 30;
/** Maximum length of a single terminal line in characters. */
const MAX_LINE_LENGTH = 4096;
/** Maximum total bytes tracked across all terminal lines (~10 MB). */
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
/** Number of recent lines to keep visible after the byte budget is exceeded. */
const TAIL_BUFFER_LINES = 200;
/** Throttle interval (ms) for flushing tail output after truncation. */
const TAIL_FLUSH_INTERVAL_MS = 500;
/** Throttle interval (ms) for pushing normal-mode output to the store. */
const NORMAL_FLUSH_INTERVAL_MS = 100;

const OUTPUT_TRUNCATION_HEADER = "[SYSTEM] Output truncated — 10 MB limit reached. Showing most recent output below.";

function formatTruncationNotice(totalBytes: number): string {
  const mb = (totalBytes / (1024 * 1024)).toFixed(1);
  return `${OUTPUT_TRUNCATION_HEADER} (${mb} MB received)`;
}

// ---------------------------------------------------------------------------
// Ring buffer -- fixed-capacity store for terminal lines with O(1) append/evict
// ---------------------------------------------------------------------------

class TerminalRingBuffer {
  private buf: (string | undefined)[];
  private head = 0;
  private _count = 0;
  private _dirty = true;
  private _cache: string[] = [];

  constructor(private capacity: number) {
    this.buf = new Array(capacity);
  }

  get count() { return this._count; }

  /**
   * Append lines. Oldest entries are evicted when capacity is exceeded.
   * Returns the evicted lines (oldest-first) so callers can keep derived
   * projections (e.g. a text-only subsequence) in sync without rescanning
   * the whole buffer.
   */
  pushMany(lines: string[]): string[] {
    if (lines.length === 0) return [];
    this._dirty = true;

    const start = lines.length > this.capacity ? lines.length - this.capacity : 0;
    const evicted: string[] = [];

    for (let i = start; i < lines.length; i++) {
      const writeIdx = (this.head + this._count) % this.capacity;
      if (this._count === this.capacity) {
        evicted.push(this.buf[writeIdx]!);
        this.buf[writeIdx] = lines[i];
        this.head = (this.head + 1) % this.capacity;
      } else {
        this.buf[writeIdx] = lines[i];
        this._count++;
      }
    }
    return evicted;
  }

  /** Return a flat string[] snapshot. Cached until next mutation. */
  toArray(): string[] {
    if (!this._dirty) return this._cache;
    const result = new Array<string>(this._count);
    for (let i = 0; i < this._count; i++) {
      result[i] = this.buf[(this.head + i) % this.capacity]!;
    }
    this._cache = result;
    this._dirty = false;
    return result;
  }

  clear(): void {
    this.head = 0;
    this._count = 0;
    this._dirty = true;
    this._cache = [];
  }
}

// ---------------------------------------------------------------------------
// Flush callback type
// ---------------------------------------------------------------------------

/**
 * Incremental projections over `output`, maintained by the sink so consumers
 * never need to re-scan the whole (up to 10k-line) buffer on every ~100ms
 * flush.
 */
export interface ExecutionOutputProjections {
  /** Last `MEANINGFUL_TAIL_SIZE` non-blank lines. */
  meaningfulTail: string[];
  /** Most recent line, or '' if none. */
  lastLine: string;
}

/** Called by the sink to push flushed output into the Zustand store. */
export interface SinkFlushCallback {
  (output: string[], totalBytes: number, projections: ExecutionOutputProjections): void;
}

// ---------------------------------------------------------------------------
// ExecutionSink
// ---------------------------------------------------------------------------

export class ExecutionSink {
  private ring = new TerminalRingBuffer(MAX_TERMINAL_LINES);
  private tailRing = new TerminalRingBuffer(TAIL_BUFFER_LINES);
  private batchLines: string[] = [];
  private batchBytes = 0;
  private batchScheduled = false;
  private generation = 0;
  private truncated = false;
  private totalBytes = 0;
  private lastTailFlushTime = 0;
  private tailFlushScheduled = false;
  private tailVisibilityUnsubscribe: (() => void) | null = null;
  private lastNormalFlushTime = 0;
  private normalFlushScheduled = false;
  private normalVisibilityUnsubscribe: (() => void) | null = null;
  private onFlush: SinkFlushCallback | null = null;

  // -- Incremental projections (normal mode only -- see recomputeProjections
  // for the tail/truncated-mode cold path) --------------------------------
  private meaningfulTail: string[] = [];
  private lastLine = '';

  /** Bind the flush callback. Called once when the slice is created. */
  bind(callback: SinkFlushCallback): void {
    this.onFlush = callback;
  }

  /** Append a single line to the batched output. */
  append(line: string): void {
    const safeLine = line.length > MAX_LINE_LENGTH
      ? line.slice(0, MAX_LINE_LENGTH) + "...[truncated]"
      : line;

    this.batchLines.push(safeLine);
    this.batchBytes += safeLine.length;

    if (!this.batchScheduled) {
      this.batchScheduled = true;
      const gen = this.generation;
      queueMicrotask(() => this.flush(gen));
    }
  }

  /** Force-flush any pending batch immediately (used before state reset). */
  forceFlush(): void {
    this.flush(this.generation);
    // flush() only schedules a throttled store push in normal mode; emit the
    // current ring snapshot synchronously so callers see the final output.
    if (!this.truncated && this.normalFlushScheduled && this.onFlush) {
      this.lastNormalFlushTime = Date.now();
      this.onFlush(this.ring.toArray(), this.totalBytes, this.currentProjections());
    }
  }

  /** Reset all state for a new execution. */
  reset(): void {
    this.resetState();
  }

  /** Clear everything and notify the store. */
  clear(): void {
    this.resetState();
  }

  /** Shared body of reset()/clear() -- see their doc comments. */
  private resetState(): void {
    this.generation++;
    this.batchLines = [];
    this.batchBytes = 0;
    this.batchScheduled = false;
    this.truncated = false;
    this.totalBytes = 0;
    this.lastTailFlushTime = 0;
    this.tailFlushScheduled = false;
    this.tailVisibilityUnsubscribe?.();
    this.tailVisibilityUnsubscribe = null;
    this.lastNormalFlushTime = 0;
    this.normalFlushScheduled = false;
    this.normalVisibilityUnsubscribe?.();
    this.normalVisibilityUnsubscribe = null;
    this.ring.clear();
    this.tailRing.clear();
    this.meaningfulTail = [];
    this.lastLine = '';
  }

  /**
   * Dev-only size probe. Returns current ring occupancy, byte total, and the
   * "spilled" flag (true once the byte budget was exceeded and tail mode is
   * active). Used by `globalThis.__executionBufferProbe__` to detect regressions
   * in long-running sessions.
   */
  probe(): { ringLines: number; tailLines: number; totalBytes: number; spilled: boolean; capacity: number } {
    return {
      ringLines: this.ring.count,
      tailLines: this.tailRing.count,
      totalBytes: this.totalBytes,
      spilled: this.truncated,
      capacity: MAX_TERMINAL_LINES,
    };
  }

  // -- Private --------------------------------------------------------

  private flush(expectedGeneration: number): void {
    this.batchScheduled = false;

    // Stale microtask from a previous execution -- discard
    if (expectedGeneration !== this.generation) return;
    if (this.batchLines.length === 0 || !this.onFlush) return;

    const linesToFlush = this.batchLines;
    const bytesToFlush = this.batchBytes;
    this.batchLines = [];
    this.batchBytes = 0;

    this.totalBytes += bytesToFlush;

    // Already in tail mode -- push to tail ring and schedule a throttled flush
    if (this.truncated) {
      this.tailRing.pushMany(linesToFlush);
      this.scheduleTailFlush();
      return;
    }

    // Normal mode -- push to main ring, then advance the incremental
    // projections by the same delta so they never need to rescan the whole
    // buffer.
    this.ring.pushMany(linesToFlush);
    this.applyProjectionDelta(linesToFlush);

    // Check if we just crossed the byte budget
    if (this.totalBytes >= MAX_TOTAL_BYTES) {
      this.truncated = true;
      // Freeze the main ring snapshot and start tail mode. This is a cold,
      // rare-once path -- recompute projections fully rather than reconcile
      // the incremental state against the reshaped (header + tail) output.
      this.ring.pushMany([formatTruncationNotice(this.totalBytes)]);
      const output = this.ring.toArray();
      this.onFlush(output, this.totalBytes, this.recomputeProjections(output));
      return;
    }

    this.scheduleNormalFlush();
  }

  /**
   * Advance the incremental projections by exactly the lines this flush added,
   * so this is O(delta) even once the ring is at capacity and evicting every
   * flush.
   */
  private applyProjectionDelta(added: string[]): void {
    for (const line of added) {
      if (line.trim().length > 0) {
        this.meaningfulTail.push(line);
        if (this.meaningfulTail.length > MEANINGFUL_TAIL_SIZE) this.meaningfulTail.shift();
      }
    }

    if (added.length > 0) this.lastLine = added[added.length - 1]!;
  }

  /** Snapshot of the incrementally-maintained projections (normal mode). */
  private currentProjections(): ExecutionOutputProjections {
    return {
      meaningfulTail: this.meaningfulTail.slice(),
      lastLine: this.lastLine,
    };
  }

  /**
   * Full recompute -- used only on the cold truncation/tail path, where the
   * output shape (header + blank + tail) is reconstructed from scratch each
   * time anyway and `tailRing` is capped at TAIL_BUFFER_LINES, so this never
   * approaches the O(10k) cost the incremental path exists to avoid.
   */
  private recomputeProjections(lines: string[]): ExecutionOutputProjections {
    const meaningfulTail: string[] = [];
    for (const line of lines) {
      if (line.trim().length > 0) {
        meaningfulTail.push(line);
        if (meaningfulTail.length > MEANINGFUL_TAIL_SIZE) meaningfulTail.shift();
      }
    }
    return { meaningfulTail, lastLine: lines[lines.length - 1] ?? '' };
  }

  /**
   * Schedule a throttled store push of the main ring. Tauri output events
   * arrive as separate tasks, so the microtask batching in `append` coalesces
   * only synchronous bursts — without this throttle every event rebuilds the
   * (up to 10k-line) snapshot array and re-renders the terminal. The first
   * flush after an idle period is immediate; subsequent flushes coalesce into
   * one store push per NORMAL_FLUSH_INTERVAL_MS window.
   */
  private scheduleNormalFlush(): void {
    if (this.normalFlushScheduled || !this.onFlush) return;
    this.normalFlushScheduled = true;

    const now = Date.now();
    const elapsed = now - this.lastNormalFlushTime;
    const delay = Math.max(0, NORMAL_FLUSH_INTERVAL_MS - elapsed);
    const gen = this.generation;

    const flushNormal = () => {
      this.normalFlushScheduled = false;
      if (gen !== this.generation || !this.onFlush) return;
      // Tail mode took over while this flush was pending -- the truncation
      // crossing already pushed the frozen ring snapshot.
      if (this.truncated) return;

      this.lastNormalFlushTime = Date.now();
      this.onFlush(this.ring.toArray(), this.totalBytes, this.currentProjections());
    };

    if (delay === 0) {
      flushNormal();
      return;
    }

    if (!getDocumentVisible()) {
      this.normalVisibilityUnsubscribe?.();
      this.normalVisibilityUnsubscribe = subscribeDocumentVisibility((visible) => {
        if (!visible) return;
        this.normalVisibilityUnsubscribe?.();
        this.normalVisibilityUnsubscribe = null;
        flushNormal();
      });
      return;
    }

    setTimeout(flushNormal, delay);
  }

  /**
   * Schedule a throttled flush of the tail buffer so we don't overwhelm the
   * store with rapid updates after truncation.
   */
  private scheduleTailFlush(): void {
    if (this.tailFlushScheduled || !this.onFlush) return;
    this.tailFlushScheduled = true;

    const now = Date.now();
    const elapsed = now - this.lastTailFlushTime;
    const delay = Math.max(0, TAIL_FLUSH_INTERVAL_MS - elapsed);
    const gen = this.generation;

    const flushTail = () => {
      this.tailFlushScheduled = false;
      if (gen !== this.generation || !this.onFlush) return;

      this.lastTailFlushTime = Date.now();

      // Build output: truncation header + tail lines. Cold path (throttled to
      // once per TAIL_FLUSH_INTERVAL_MS, bounded by TAIL_BUFFER_LINES) -- full
      // recompute is cheap and simpler than reconciling incremental state
      // against this reshaped output.
      const tailLines = this.tailRing.toArray();
      const output = [
        formatTruncationNotice(this.totalBytes),
        "",
        ...tailLines,
      ];
      this.onFlush(output, this.totalBytes, this.recomputeProjections(output));
    };

    if (!getDocumentVisible()) {
      this.tailVisibilityUnsubscribe?.();
      this.tailVisibilityUnsubscribe = subscribeDocumentVisibility((visible) => {
        if (!visible) return;
        this.tailVisibilityUnsubscribe?.();
        this.tailVisibilityUnsubscribe = null;
        flushTail();
      });
      return;
    }

    setTimeout(flushTail, delay);
  }
}

/** Singleton sink instance shared by the execution slice. */
export const executionSink = new ExecutionSink();
