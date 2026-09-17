// Self-test for scripts/test/lib/stream-timing.mjs.
//
// The defect this defends against is not an arithmetic error. It is a column
// heading: the bench used to publish "p50 first-token" from the first
// `content_block_delta` of ANY kind, and on this CLI a thinking turn's first
// delta is `{"type":"thinking_delta","thinking":"","estimated_tokens":50}` —
// an envelope carrying zero characters. The two fixtures are REAL recorded
// streams (arrival offsets stamped by the recorder, text truncated): one turn
// that thought first and one that did not. Whether a turn thinks tracks the
// reasoning-effort axis the bench compares cells on, so the old single number
// took its stamp at a different event depending on the cell.
//
// Run:  node scripts/test/__tests__/stream-timing.test.mjs

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createTurnTimer, timeRecordedFeed } from "../lib/stream-timing.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, "..", "fixtures", "stream-timing");

let passed = 0;
let failed = 0;
const failures = [];
function expect(label, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    failures.push({ label, detail });
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const load = (name) =>
  readFileSync(resolve(FIXTURES, name), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

/** The pooled classifier this module replaced, kept ONLY so the fixtures can
 *  be shown to exercise the difference. If this ever stops disagreeing with
 *  the module on the thinking fixture, the fixture has gone stale and the
 *  test below is asserting nothing. */
function pooledFirstDelta(rows) {
  for (const row of rows) {
    let ev;
    try { ev = JSON.parse(row.raw); } catch { continue; }
    if (ev.type === "stream_event" && ev.event?.type === "content_block_delta") return row.ms;
    if (ev.type === "assistant") return row.ms;
  }
  return null;
}

console.log("Case 1: A REAL THINKING TURN — the stamp moves, and says where it landed");
{
  const rows = load("thinking-then-text.jsonl");
  const t = timeRecordedFeed(rows);
  expect("first forwarded chunk is a thinking delta", t.firstChunkKind === "thinking_delta", String(t.firstChunkKind));
  expect("first visible text is later than the first chunk", t.firstVisibleTextMs > t.firstChunkMs, `${t.firstChunkMs} -> ${t.firstVisibleTextMs}`);
  expect("nothing is unmeasured on this turn", t.unmeasured === null, String(t.unmeasured));
  // The whole point: the old single figure is the EARLY one, and it is the one
  // that used to be published under a token's name.
  const pooled = pooledFirstDelta(rows);
  expect("the pooled figure equals the chunk stamp, not the text stamp", pooled === t.firstChunkMs && pooled !== t.firstVisibleTextMs, `pooled=${pooled}`);
  expect("the fixture's gap is large enough to matter", t.firstVisibleTextMs - t.firstChunkMs > 1000, `${t.firstVisibleTextMs - t.firstChunkMs} ms`);
  // A whole finished block is a third event, later again than the text delta's
  // start, and the old fallback stamped there.
  expect("the first complete message lands on the thinking block", Array.isArray(t.firstMessageBlocks) && t.firstMessageBlocks[0] === "thinking", JSON.stringify(t.firstMessageBlocks));
}

console.log("Case 2: A REAL NON-THINKING TURN — the instrument can report no difference");
{
  const rows = load("text-only.jsonl");
  const t = timeRecordedFeed(rows);
  expect("first chunk is the text delta", t.firstChunkKind === "text_delta", String(t.firstChunkKind));
  expect("the two stamps coincide", t.firstChunkMs === t.firstVisibleTextMs, `${t.firstChunkMs} vs ${t.firstVisibleTextMs}`);
  expect("the pooled figure agrees here", pooledFirstDelta(rows) === t.firstVisibleTextMs);
}

console.log("Case 3: A TURN THAT STREAMS NO TEXT — refusal, never a borrowed stamp");
{
  const rows = [
    { ms: 10, raw: JSON.stringify({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "tool_use" } } }) },
    { ms: 20, raw: JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"a' } } }) },
    { ms: 99, raw: JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use" }] } }) },
  ];
  const t = timeRecordedFeed(rows);
  expect("first visible text is null", t.firstVisibleTextMs === null);
  expect("and it says why", t.unmeasured === "no-visible-text-delta", String(t.unmeasured));
  expect("the first chunk is still reported, with its kind", t.firstChunkMs === 20 && t.firstChunkKind === "input_json_delta");
  expect("the message stamp is reported separately, not as a token", t.firstMessageMs === 99);
}

console.log("Case 4: THE LIVE-CLOCK PATH — the same rules under Date.now()");
{
  let clock = 0;
  const timer = createTurnTimer(() => clock);
  clock = 5;
  timer.observe({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "" } } });
  clock = 50;
  timer.observe({ type: "assistant", message: { content: [{ type: "thinking" }] } });
  clock = 60;
  timer.observe({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "hi" } } });
  clock = 70;
  const t = timer.read();
  expect("chunk at 5, text at 60, message at 50", t.firstChunkMs === 5 && t.firstVisibleTextMs === 60 && t.firstMessageMs === 50, JSON.stringify(t));
  expect("total is read at read() time", t.totalMs === 70, String(t.totalMs));
  expect("a malformed event is ignored, not fatal", (() => { timer.observe(null); timer.observe({ type: "stream_event" }); return true; })());
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  for (const f of failures) console.error(`  - ${f.label}${f.detail ? `: ${f.detail}` : ""}`);
  process.exit(1);
}
