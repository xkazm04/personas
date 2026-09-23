// WP4 (spark athena-layered-voice) — vitest wrapper around the SAME 5
// fixtures the bench harness's `node scripts/test/athena-model-bench.mjs
// --self-test` runs, so the replyShape counters (sentence cap, bare-id
// leak, ref-link well-formedness) are unit-checked from both `npm run test`
// and the bench's own acceptance flag without duplicating the fixtures.
// The counters live in scripts/test/lib/reply-shape.mjs (plain JS, no Tauri
// deps) rather than under src/lib, because they are shared with the bench
// harness and the reply-stats CLI, neither of which is part of the app
// bundle — see docs/features/companion/layered-voice.md "Measurement".
import { describe, expect, it } from "vitest";
import { replyShape } from "../../../scripts/test/lib/reply-shape.mjs";
import { FIXTURES } from "../../../scripts/test/lib/reply-shape-self-test.mjs";

describe("replyShape counters (layered voice, WP4)", () => {
  it.each(FIXTURES)("$name", ({ text, expect: expected }) => {
    const shape = replyShape(text);
    for (const [key, value] of Object.entries(expected)) {
      expect(shape[key as keyof typeof shape]).toBe(value);
    }
  });

  it("never scores a fixture as having zero words for non-empty text", () => {
    for (const f of FIXTURES) {
      expect(replyShape(f.text).words).toBeGreaterThan(0);
    }
  });
});
