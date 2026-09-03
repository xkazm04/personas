/**
 * Frame-batched line buffer for correlated CLI streams.
 *
 * Two mechanics, both lifted from the sibling primitive
 * `hooks/realtime/createSingletonListener.ts` (`frameQueue` at :37-77 and the
 * counted `earlyBuffer` at :79-95). That primitive cannot be reused directly
 * here: it is a module-scope singleton keyed by one event name, while a
 * correlated CLI stream is per-mount and its event names are generic and
 * chosen by the caller. So the mechanics are extracted rather than the
 * primitive shared -- and `createSingletonListener.ts` is untouched.
 *
 * 1. **Per-frame batching.** Every Tauri output event arrives in its own task,
 *    so React 19 cannot batch the `setLines` calls: a 1,000-line burst was
 *    1,000 renders. Lines are collected and handed over once per animation
 *    frame (microtask fallback where there is no rAF, e.g. jsdom), which is
 *    one render per frame no matter how fast the CLI talks.
 *
 * 2. **A counted hold buffer for the registration window.** `start()` cannot
 *    render a line before its `listen()` promises resolve. Lines that arrive
 *    while the buffer is not yet armed are held rather than dropped, and the
 *    number the hold buffer could not keep is counted rather than lost
 *    silently.
 *
 *    What this CANNOT see, stated rather than papered over: anything the
 *    backend emits before `listen()` resolves never reaches the frontend at
 *    all, so it can be neither buffered nor counted from here. The two
 *    registrations now run concurrently, which halves that window; closing it
 *    needs a backend-side replay (the shape `useBackgroundSnapshot` already
 *    has for n8n transform), not a frontend buffer.
 */

/** Pending flushes, so a test can drain every live buffer synchronously. */
const pendingFlushes = new Set<() => void>();

function scheduleFrame(run: () => void): void {
  const schedule =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: FrameRequestCallback): number => {
          queueMicrotask(() => cb(0));
          return 0;
        };
  schedule(() => run());
}

export interface CliStreamBufferOptions {
  /** Called once per animation frame with every line collected since the last. */
  onBatch: (lines: string[]) => void;
  /**
   * Cap on the hold buffer used before `arm()`. Lines beyond it are counted as
   * dropped. Defaults to the stream's own line cap, so the hold buffer never
   * discards a line the settled buffer would have kept anyway.
   */
  maxHeld?: number;
}

export interface CliStreamBuffer {
  /** Queue one line for the next frame (or hold it if not yet armed). */
  push(line: string): void;
  /** Listeners are attached: release anything held and start flushing. */
  arm(): void;
  /** Flush synchronously. Used by `dispose()` and by tests. */
  flushNow(): void;
  /** Stop scheduling; drop anything still queued. */
  dispose(): void;
  /** Lines the hold buffer could not keep. Never resets while the buffer lives. */
  earlyDroppedCount(): number;
}

export function createCliStreamBuffer({
  onBatch,
  maxHeld = 5000,
}: CliStreamBufferOptions): CliStreamBuffer {
  let queue: string[] = [];
  let held: string[] = [];
  let armed = false;
  let scheduled = false;
  let disposed = false;
  let droppedCount = 0;
  let dropWarned = false;

  const flush = () => {
    scheduled = false;
    pendingFlushes.delete(flush);
    if (disposed || queue.length === 0) return;
    const batch = queue;
    queue = [];
    onBatch(batch);
  };

  const schedule = () => {
    if (scheduled || disposed) return;
    scheduled = true;
    pendingFlushes.add(flush);
    scheduleFrame(flush);
  };

  return {
    push(line: string) {
      if (disposed) return;
      if (!armed) {
        if (held.length < maxHeld) {
          held.push(line);
        } else {
          droppedCount += 1;
          if (!dropWarned) {
            dropWarned = true;
            console.warn(
              `[cli-stream] hold buffer exceeded its cap of ${maxHeld} lines before the listeners were armed; further drops are counted silently`,
            );
          }
        }
        return;
      }
      queue.push(line);
      schedule();
    },
    arm() {
      if (disposed || armed) return;
      armed = true;
      if (held.length > 0) {
        queue.push(...held);
        held = [];
        schedule();
      }
    },
    flushNow() {
      flush();
    },
    dispose() {
      disposed = true;
      scheduled = false;
      pendingFlushes.delete(flush);
      queue = [];
      held = [];
    },
    earlyDroppedCount() {
      return droppedCount;
    },
  };
}

/**
 * Append a batch to the settled line array, suppressing adjacent duplicates
 * (across the seam as well as inside the batch) and enforcing `cap` exactly.
 *
 * The old append ran `prev.slice(prev.length - MAX + 1)` + `push` for EVERY
 * line once the cap was reached: an O(n) copy of 5,000 strings per line, on a
 * hot path that also re-rendered per line. The trim is now amortised over the
 * frame batch -- one copy per flush rather than one per line, so a
 * 1,000-line burst at the cap costs 1 copy instead of 1,000 -- while the cap
 * itself stays exact, because it is a memory guard the tests assert on.
 *
 * Returns `prev` unchanged when the batch adds nothing, so a burst of repeated
 * lines does not force a re-render.
 */
export function appendCappedLines(prev: string[], batch: string[], cap: number): string[] {
  let last = prev[prev.length - 1];
  const additions: string[] = [];
  for (const line of batch) {
    if (line === last) continue;
    additions.push(line);
    last = line;
  }
  if (additions.length === 0) return prev;

  const next = prev.concat(additions);
  if (next.length <= cap) return next;
  return next.slice(next.length - cap);
}

/**
 * Test-only: run every pending frame flush synchronously.
 *
 * The same escape hatch `createSingletonListener.__resetForTests` exists for:
 * a scheduler that waits for a real animation frame is invisible to a
 * synchronous assertion, and a test that cannot see the flush would otherwise
 * be rewritten to assert something weaker.
 */
export function flushCliStreamFrames(): void {
  for (const flush of [...pendingFlushes]) flush();
}
