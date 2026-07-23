// GOLDEN EVAL — the Athena "Play in chat" composer seed.
//
// When the user clicks "Play in chat" on a persona message, `buildSummariseChatPrompt`
// composes the prompt that lands in Athena's composer and is dispatched to the main chat
// turn (Tiger's apex user-facing surface, athena-main-chat-turn). This eval runs the REAL
// builder over a recorded message + its linked human reviews and pins: (1) GROUNDING — the
// persona, execution, message body, and every pending review reach the seed; (2) the
// "cover these things" instruction survives; (3) missing-field fallbacks stay graceful.
// Deterministic, no LLM.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSummariseChatPrompt } from "../../src/features/overview/sub_messages/libs/chatSeed";
import type { PersonaMessage } from "../../src/lib/types/types";
import type { PersonaManualReview } from "../../src/lib/bindings/PersonaManualReview";

const fx = JSON.parse(
  readFileSync(join(process.cwd(), "evals", "fixtures", "athena-chat", "message.json"), "utf8"),
) as { message: PersonaMessage; linkedReviews: PersonaManualReview[]; sparseMessage: PersonaMessage };

describe("athena chat seed — grounded message + reviews", () => {
  const prompt = buildSummariseChatPrompt(fx.message, fx.linkedReviews);

  it("grounds in the persona, execution id, title, and message body", () => {
    expect(prompt).toContain(fx.message.persona_name!);
    expect(prompt).toContain(fx.message.execution_id!);
    expect(prompt).toContain(fx.message.title!);
    expect(prompt).toContain(fx.message.content);
  });

  it("folds every linked human review in with its severity", () => {
    expect(prompt).toContain("--- Linked human reviews ---");
    for (const r of fx.linkedReviews) {
      expect(prompt).toContain(`- Pending review: ${r.title} (${r.severity})`);
    }
  });

  it("keeps the coverage instruction (produced / notable / pending actions)", () => {
    expect(prompt).toMatch(/Cover: what the persona produced/i);
    expect(prompt).toMatch(/review actions pending/i);
  });
});

describe("athena chat seed — graceful fallbacks", () => {
  const prompt = buildSummariseChatPrompt(fx.sparseMessage, []);

  it("substitutes sane placeholders for missing fields", () => {
    expect(prompt).toContain("Persona: this agent"); // no persona_name
    expect(prompt).toContain("Execution ID: (none)"); // null execution_id
    expect(prompt).toContain("Message title: (untitled)"); // null title
    expect(prompt).toContain("(empty)"); // empty content
  });

  it("omits the reviews section entirely when there are none", () => {
    expect(prompt).not.toContain("--- Linked human reviews ---");
  });
});
