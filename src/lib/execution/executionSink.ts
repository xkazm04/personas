/**
 * ExecutionSink -- self-contained terminal output subsystem that owns the ring
 * buffer, batching, byte budget, and flush scheduling.
 *
 * Extracted from executionSlice.ts to eliminate module-level mutable state and
 * the captured Zustand setter hack.  The execution slice holds a single sink
 * reference and delegates append/clear to it.
 */

/** Maximum terminal output lines kept in memory to prevent OOM on long executions. */
const MAX_TERMINAL_LINES = 10_000;
/** Maximum length of a single terminal line in characters. */
const MAX_LINE_LENGTH = 4096;
/** Maximum total bytes tracked across all terminal lines (~10 MB). */
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
/** Number of recent lines to keep visible after the byte budget is exceeded. */
const TAIL_BUFFER_LINES = 200;
/** Throttle interval (ms) for flushing tail output after truncation. */
const TAIL_FLUSH_INTERVAL_MS = 500;

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

  /** Append lines. Oldest entries are evicted when capacity is exceeded. */
  pushMany(lines: string[]): void {
    if (lines.length === 0) return;
    this._dirty = true;

    const start = lines.length > this.capacity ? lines.length - this.capacity : 0;

    for (let i = start; i < lines.length; i++) {
      const writeIdx = (this.head + this._count) % this.capacity;
      if (this._count === this.capacity) {
        this.buf[writeIdx] = lines[i];
        this.head = (this.head + 1) % this.capacity;
      } else {
        this.buf[writeIdx] = lines[i];
        this._count++;
      }
    }
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

/** Called by the sink to push flushed output into the Zustand store. */
export interface SinkFlushCallback {
  (output: string[], totalBytes: number): void;
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
  private onFlush: SinkFlushCallback | null = null;

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
  }

  /** Reset all state for a new execution. */
  reset(): void {
    this.generation++;
    this.batchLines = [];
    this.batchBytes = 0;
    this.batchScheduled = false;
    this.truncated = false;
    this.totalBytes = 0;
    this.lastTailFlushTime = 0;
    this.tailFlushScheduled = false;
    this.ring.clear();
    this.tailRing.clear();
  }

  /** Clear everything and notify the store. */
  clear(): void {
    this.generation++;
    this.batchLines = [];
    this.batchBytes = 0;
    this.batchScheduled = false;
    this.truncated = false;
    this.totalBytes = 0;
    this.lastTailFlushTime = 0;
    this.tailFlushScheduled = false;
    this.ring.clear();
    this.tailRing.clear();
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

    // Normal mode -- push to main ring
    this.ring.pushMany(linesToFlush);

    // Check if we just crossed the byte budget
    if (this.totalBytes >= MAX_TOTAL_BYTES) {
      this.truncated = true;
      // Freeze the main ring snapshot and start tail mode
      this.ring.pushMany([formatTruncationNotice(this.totalBytes)]);
      this.onFlush(this.ring.toArray(), this.totalBytes);
      return;
    }

    this.onFlush(this.ring.toArray(), this.totalBytes);
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

    setTimeout(() => {
      this.tailFlushScheduled = false;
      if (gen !== this.generation || !this.onFlush) return;

      this.lastTailFlushTime = Date.now();

      // Build output: truncation header + tail lines
      const tailLines = this.tailRing.toArray();
      const output = [
        formatTruncationNotice(this.totalBytes),
        "",
        ...tailLines,
      ];
      this.onFlush(output, this.totalBytes);
    }, delay);
  }
}

/** Singleton sink instance shared by the execution slice. */
export const executionSink = new ExecutionSink();
