import { describe, it, expect } from "vitest";
import { ExecutionSink, type ExecutionOutputProjections } from "../executionSink";

const MEANINGFUL_TAIL_SIZE = 30;
const MAX_TERMINAL_LINES = 10_000;

/** Reference implementations -- the old O(full-buffer) per-consumer logic this ADR replaces. */
function oldMeaningfulTail(output: string[]): string[] {
  return output.filter((l) => l.trim().length > 0).slice(-MEANINGFUL_TAIL_SIZE);
}
function oldLastLine(output: string[]): string {
  return output[output.length - 1] ?? "";
}

interface Flush {
  output: string[];
  totalBytes: number;
  projections: ExecutionOutputProjections;
}

/** Fresh sink + a recorder of every onFlush call, decoupled from the module singleton. */
function makeSink() {
  const sink = new ExecutionSink();
  const flushes: Flush[] = [];
  sink.bind((output, totalBytes, projections) => {
    flushes.push({
      output: output.slice(),
      totalBytes,
      projections: {
        meaningfulTail: projections.meaningfulTail.slice(),
        lastLine: projections.lastLine,
        droppedLines: projections.droppedLines,
      },
    });
  });
  return { sink, flushes };
}

/**
 * Append a batch then force-flush it synchronously. forceFlush() always emits
 * (either via the throttle's delay=0 fast path or its own explicit fallback
 * when the throttle is pending), so tests never need fake timers.
 */
function appendAndFlush(sink: ExecutionSink, lines: string[]): void {
  for (const line of lines) sink.append(line);
  sink.forceFlush();
}

function assertProjectionsMatchOutput(flush: Flush): void {
  expect(flush.projections.meaningfulTail).toEqual(oldMeaningfulTail(flush.output));
  expect(flush.projections.lastLine).toBe(oldLastLine(flush.output));
}

describe("ExecutionSink incremental projections", () => {
  it("matches the old full-buffer scan for a mixed stream, across multiple flushes", () => {
    const { sink, flushes } = makeSink();

    appendAndFlush(sink, ["Hello world", "", "> Using tool: Read", "[ERROR] boom", "more text"]);
    assertProjectionsMatchOutput(flushes[flushes.length - 1]!);

    appendAndFlush(sink, ["another text line", "  subagent chatter", "", "> Cancelled"]);
    const last = flushes[flushes.length - 1]!;
    expect(last.output).toEqual([
      "Hello world", "", "> Using tool: Read", "[ERROR] boom", "more text",
      "another text line", "  subagent chatter", "", "> Cancelled",
    ]);
    assertProjectionsMatchOutput(last);
  });

  it("caps meaningfulTail at 30 non-blank lines, matching the old slice(-30)", () => {
    const { sink, flushes } = makeSink();
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i}`);
    appendAndFlush(sink, lines);
    const last = flushes[flushes.length - 1]!;
    expect(last.projections.meaningfulTail).toHaveLength(MEANINGFUL_TAIL_SIZE);
    assertProjectionsMatchOutput(last);
  });

  it("tool/meta lines still advance meaningfulTail and lastLine -- the tail is classification-blind", () => {
    const { sink, flushes } = makeSink();
    appendAndFlush(sink, ["first text line"]);

    appendAndFlush(sink, ["> Using tool: Read", "  Tool result: ok"]);
    const afterTool = flushes[flushes.length - 1]!;

    expect(afterTool.projections.meaningfulTail).toEqual([
      "first text line", "> Using tool: Read", "  Tool result: ok",
    ]);
    expect(afterTool.projections.lastLine).toBe("  Tool result: ok");
    assertProjectionsMatchOutput(afterTool);
  });

  it("blank lines never advance meaningfulTail, but do advance lastLine", () => {
    const { sink, flushes } = makeSink();
    appendAndFlush(sink, ["real content"]);
    appendAndFlush(sink, ["", "   "]);
    const last = flushes[flushes.length - 1]!;
    expect(last.projections.meaningfulTail).toEqual(["real content"]);
    expect(last.projections.lastLine).toBe("   ");
    assertProjectionsMatchOutput(last);
  });

  it("evicts the oldest lines once they fall out of the 10k-line ring window, and counts + discloses the eviction", () => {
    const { sink, flushes } = makeSink();
    const total = MAX_TERMINAL_LINES + 50;
    const allLines = Array.from({ length: total }, (_, i) =>
      i % 7 === 0 ? `[ERROR] boom ${i}` : `text line ${i}`,
    );

    const chunkSize = 500;
    for (let i = 0; i < allLines.length; i += chunkSize) {
      appendAndFlush(sink, allLines.slice(i, i + chunkSize));
    }

    const last = flushes[flushes.length - 1]!;
    expect(last.projections.droppedLines).toBe(50);
    expect(sink.probe().droppedLines).toBe(50);
    // The notice is synthesised at the head, so the ring still holds a full
    // MAX_TERMINAL_LINES of real output -- the disclosure costs no slot.
    expect(last.output[0]).toBe(
      "[SYSTEM] Terminal buffer full — 50 earlier lines dropped. Showing the most recent 10,000 lines below.",
    );
    expect(last.output).toHaveLength(MAX_TERMINAL_LINES + 1);
    expect(last.output.slice(1)).toEqual(allLines.slice(-MAX_TERMINAL_LINES));
    assertProjectionsMatchOutput(last);
  });

  it("a 12,000-line run reports 2,000 dropped lines and says so at the head of the output", () => {
    const { sink, flushes } = makeSink();
    const allLines = Array.from({ length: 12_000 }, (_, i) => `line ${i}`);

    const chunkSize = 1_000;
    for (let i = 0; i < allLines.length; i += chunkSize) {
      appendAndFlush(sink, allLines.slice(i, i + chunkSize));
    }

    const last = flushes[flushes.length - 1]!;
    expect(last.projections.droppedLines).toBe(2_000);
    expect(last.output[0]).toBe(
      "[SYSTEM] Terminal buffer full — 2,000 earlier lines dropped. Showing the most recent 10,000 lines below.",
    );
    // Without the notice the terminal would simply start at line 2,000 with
    // nothing saying why -- that first surviving line is still line 2,000.
    expect(last.output[1]).toBe("line 2000");
    expect(last.output).toHaveLength(MAX_TERMINAL_LINES + 1);
    assertProjectionsMatchOutput(last);

    // The count is per-execution: the next run must not inherit this one's
    // notice on its very first flush.
    sink.reset();
    appendAndFlush(sink, ["fresh run, first line"]);
    const afterReset = flushes[flushes.length - 1]!;
    expect(afterReset.projections.droppedLines).toBe(0);
    expect(afterReset.output).toEqual(["fresh run, first line"]);
  });

  it("a run that never fills the ring reports 0 dropped lines and shows no notice", () => {
    const { sink, flushes } = makeSink();
    appendAndFlush(sink, ["one", "two", "three"]);
    const last = flushes[flushes.length - 1]!;
    expect(last.projections.droppedLines).toBe(0);
    expect(last.output).toEqual(["one", "two", "three"]);
  });

  it("recomputes projections at the truncation crossing and again for the reshaped [header, '', ...tail] tail flush", async () => {
    const { sink, flushes } = makeSink();
    // MAX_TOTAL_BYTES is 10MB and MAX_LINE_LENGTH truncates any single line to
    // 4096 chars + "...[truncated]" (~4111 bytes) -- ~2550 such lines cross it.
    const lines = Array.from({ length: 2600 }, (_, i) => `${"x".repeat(5000)}-${i}`);

    appendAndFlush(sink, lines);
    const crossing = flushes[flushes.length - 1]!;
    // At the crossing, the ring is frozen with the notice appended at the end
    // -- it has not yet reshaped into the [header, "", ...tail] tail-mode form.
    expect(crossing.output[crossing.output.length - 1]).toMatch(/Output truncated/);
    assertProjectionsMatchOutput(crossing);

    // Unlike scheduleNormalFlush, scheduleTailFlush has no delay===0 fast path
    // -- it always defers through a real setTimeout. Wait for the real timer.
    sink.append("one more line after truncation");
    await new Promise((resolve) => setTimeout(resolve, 20));

    const tailFlush = flushes[flushes.length - 1]!;
    expect(tailFlush.output[0]).toMatch(/Output truncated/);
    expect(tailFlush.output[1]).toBe("");
    expect(tailFlush.output[2]).toBe("one more line after truncation");
    assertProjectionsMatchOutput(tailFlush);
  });

  it("forceFlush emits the tail synchronously in tail mode, so a truncated run's final [ERROR] line reaches the completed snapshot", () => {
    const { sink, flushes } = makeSink();
    appendAndFlush(sink, Array.from({ length: 2600 }, (_, i) => `${"x".repeat(5000)}-${i}`));
    const flushesAfterCrossing = flushes.length;

    // The run ends here: usePersonaExecution appends its terminal [ERROR] line
    // and finishExecution force-flushes, then snapshots the store immediately.
    // No timers are advanced -- the tail throttle is 500 ms, so before this fix
    // the line was simply absent from the snapshot.
    sink.append("[ERROR] run failed at the very end");
    sink.forceFlush();

    expect(flushes.length).toBeGreaterThan(flushesAfterCrossing);
    const final = flushes[flushes.length - 1]!;
    expect(final.output[0]).toMatch(/Output truncated/);
    expect(final.output[1]).toBe("");
    expect(final.output[final.output.length - 1]).toBe("[ERROR] run failed at the very end");
    expect(final.projections.lastLine).toBe("[ERROR] run failed at the very end");
    assertProjectionsMatchOutput(final);
  });

  it("reset() clears projections so a stale generation can't pollute the next execution", () => {
    const { sink, flushes } = makeSink();
    appendAndFlush(sink, ["stale text", "[ERROR] stale error"]);

    sink.reset();
    appendAndFlush(sink, ["fresh line"]);

    const last = flushes[flushes.length - 1]!;
    expect(last.output).toEqual(["fresh line"]);
    expect(last.projections.meaningfulTail).toEqual(["fresh line"]);
    expect(last.projections.lastLine).toBe("fresh line");
  });

  it("a stale microtask queued before reset() cannot resurrect the previous execution's projections", async () => {
    const { sink, flushes } = makeSink();
    sink.append("about to be abandoned"); // schedules a microtask flush for generation 0
    sink.reset(); // bumps the generation before that microtask runs

    sink.append("fresh line");
    sink.forceFlush();

    // Let the stale generation-0 microtask (if it were going to fire) run.
    await Promise.resolve();
    await Promise.resolve();

    const last = flushes[flushes.length - 1]!;
    expect(last.output).toEqual(["fresh line"]);
    assertProjectionsMatchOutput(last);
  });
});
