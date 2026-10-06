import { describe, it, expect } from 'vitest';
import fixture from '../../../../../fixtures/chat-turn-input-v1.json';
import { classifyLine } from '@/lib/utils/terminalColors';

/**
 * Parity pin for the persona chat turn's move into Rust (PHASE2-SPEC 5.3).
 *
 * `chatSlice.sendChatMessage` used to build the run's input JSON itself. That
 * builder now lives in `src-tauri/src/commands/core/chat_turn.rs`, and the
 * shared fixture `fixtures/chat-turn-input-v1.json` holds what the TypeScript
 * builder produced for each session state (first turn, resumed turn, a
 * follow-up with no Claude session, advisory vs agent, escaping). The Rust
 * tests reproduce every case with the Rust builder; this test reproduces them
 * with the TypeScript builder below, copied VERBATIM from chatSlice.ts as of
 * e8ff8b41ff (steps 3-4 of sendChatMessage, deriveTitle, buildSummary) - so
 * the fixture is provably what the old path sent, and the reply filter is
 * checked against the production `classifyLine`.
 */

type Line = { role: string; content: string };

// ---- verbatim from chatSlice.ts (e8ff8b41ff) --------------------------------

function deriveTitle(content: string): string {
  const clean = content.replace(/\s+/g, ' ').trim();
  if (clean.length <= 60) return clean;
  return clean.slice(0, 57) + '...';
}

function buildSummary(messages: Line[]): string {
  const recent = messages.slice(-20);
  return recent
    .map((m) => `${m.role === "user" ? "Human" : "Assistant"}: ${m.content.slice(0, 300)}`)
    .join("\n\n");
}

function buildTurnInput(
  chatMode: string,
  isFirstMessage: boolean,
  claudeSessionId: string | null,
  allMessages: Line[],
  content: string,
): { input: string; continuation: { type: string; value: string } | null } {
  const isAdvisory = chatMode === 'advisory';
  let conversationInput: string;
  let continuation: { type: string; value: string } | undefined;
  if (claudeSessionId && !isFirstMessage) {
    conversationInput = JSON.stringify({
      _chat: true,
      latest_message: content,
    });
    continuation = { type: "SessionResume", value: claudeSessionId };
  } else {
    const contextLines = allMessages.map(
      (m) => `${m.role === "user" ? "Human" : "Assistant"}: ${m.content}`,
    );
    conversationInput = JSON.stringify({
      ...(isAdvisory ? { _advisory: true } : { _chat: true }),
      conversation: contextLines.join("\n\n"),
      latest_message: content,
    });
  }
  return { input: conversationInput, continuation: continuation ?? null };
}

// -----------------------------------------------------------------------------

describe('persona chat turn parity fixture', () => {
  it('holds the input JSON the TypeScript builder produced, for every session state', () => {
    expect(fixture.inputs.length).toBeGreaterThanOrEqual(8);
    for (const c of fixture.inputs) {
      const built = buildTurnInput(
        c.chatMode,
        c.isFirstMessage,
        c.claudeSessionId,
        c.transcript,
        c.message,
      );
      expect(built, c.name).toEqual(c.expected);
    }
  });

  it('holds the titles and summaries the TypeScript helpers produced', () => {
    for (const t of fixture.titles) {
      expect(deriveTitle(t.content), t.content).toBe(t.expected);
    }
    for (const s of fixture.summaries) {
      expect(buildSummary(s.messages), s.name).toBe(s.expected);
    }
  });

  it('holds the reply filter of the production classifyLine', () => {
    for (const l of fixture.lines) {
      expect(classifyLine(l.line) === 'text', JSON.stringify(l.line)).toBe(l.isText);
    }
  });
});
