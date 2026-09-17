/**
 * Turn timing off a stream-json event feed, with every published figure
 * carrying the event class its stamp was taken at.
 *
 * Why this is a module and not four lines in the bench: the bench used to
 * publish a column called "first-token" whose stamp was taken at the first
 * `content_block_delta` of ANY kind, with a silent fallback to the first
 * complete `assistant` message when no delta had been seen. On this CLI the
 * first delta of a thinking turn is a `thinking_delta` whose text is empty
 * (`{"type":"thinking_delta","thinking":"","estimated_tokens":50}`) — an
 * envelope, not a token — and the fallback stamps at a whole finished block.
 * So one column pooled three different measurements, and the cells being
 * compared differ in reasoning effort, which is exactly the axis that decides
 * WHICH of the three a cell's stamp comes from.
 *
 * The rule this encodes: a latency figure states the two events it is measured
 * between, and stamps taken at different events never share a series.
 */

/** Deltas that carry text a reader would call output. */
const VISIBLE_TEXT_DELTA = "text_delta";

/**
 * @param {() => number} now injectable clock (tests drive it)
 */
export function createTurnTimer(now = () => Date.now()) {
  const t0 = now();

  /** first delta of any kind that the transport forwarded */
  let firstChunkMs = null;
  let firstChunkKind = null;
  /** first delta carrying visible output text */
  let firstVisibleTextMs = null;
  /** first COMPLETE assistant message, i.e. a whole block, not a token */
  let firstMessageMs = null;
  let firstMessageBlocks = null;

  return {
    /** Feed one parsed stream-json line. */
    observe(ev) {
      const at = now() - t0;
      if (ev?.type === "stream_event" && ev.event?.type === "content_block_delta") {
        const kind = ev.event.delta?.type ?? "unknown_delta";
        if (firstChunkMs === null) {
          firstChunkMs = at;
          firstChunkKind = kind;
        }
        if (kind === VISIBLE_TEXT_DELTA && firstVisibleTextMs === null) {
          firstVisibleTextMs = at;
        }
        return;
      }
      if (ev?.type === "assistant" && firstMessageMs === null) {
        firstMessageMs = at;
        firstMessageBlocks = (ev.message?.content ?? []).map((b) => b.type);
      }
    },

    /**
     * The timing record. Three named intervals, each anchored at the spawn and
     * ending at a NAMED event, plus the class the end event belonged to.
     * `firstVisibleTextMs` is null — never substituted — when the turn produced
     * no text delta, and `unmeasured` says why, so an aggregate cannot quietly
     * average a message stamp into a token series.
     */
    read() {
      return {
        firstVisibleTextMs,
        firstChunkMs,
        firstChunkKind,
        firstMessageMs,
        firstMessageBlocks,
        unmeasured: firstVisibleTextMs === null ? "no-visible-text-delta" : null,
        totalMs: now() - t0,
      };
    },
  };
}

/**
 * Replay a recorded feed: rows of `{ ms, raw }` where `ms` is the arrival
 * offset the recorder stamped and `raw` is the CLI's line. Used by the tests
 * and by any offline re-read of a recorded campaign.
 */
export function timeRecordedFeed(rows) {
  let clock = 0;
  const timer = createTurnTimer(() => clock);
  for (const row of rows) {
    clock = row.ms;
    let ev;
    try {
      ev = typeof row.raw === "string" ? JSON.parse(row.raw) : row.raw;
    } catch {
      continue;
    }
    timer.observe(ev);
  }
  return timer.read();
}
