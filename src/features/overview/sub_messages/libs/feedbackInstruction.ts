/**
 * Prompt enrichment helper for the feedback-chat flow.
 *
 * When a user submits feedback on a persona message, we don't want to send
 * the raw feedback text alone — the persona has no context about which of
 * its past outputs the user is reacting to. This helper assembles a richer
 * advisory instruction that includes:
 *   - a topic marker (pre-selected from the message metadata)
 *   - an excerpt of the original message the user is reacting to
 *   - the user's feedback text
 *   - a clear directive for what the persona should do with it
 *
 * The output is plain text meant to become the first user turn of a new
 * advisory-mode chat session. Claude's advisory wrapper will then add its
 * own diagnostic framing on top.
 */
import type { PersonaMessage } from "@/lib/types/types";

/** Max chars of source message content included in the instruction. */
const MAX_MESSAGE_EXCERPT = 600;

/** Max chars of feedback text kept intact (feedback is usually short anyway). */
const MAX_FEEDBACK_LENGTH = 2000;

/** Short topic marker derived from message metadata. */
function buildTopicMarker(msg: PersonaMessage): string {
  const parts: string[] = [];
  if (msg.content_type) parts.push(msg.content_type);
  if (msg.priority && msg.priority !== "normal") parts.push(`${msg.priority}-priority`);
  const subject = msg.title?.trim() || "untitled output";
  const descriptor = parts.length > 0 ? `${parts.join(" ")} "${subject}"` : `"${subject}"`;
  return `[feedback on ${descriptor}]`;
}

/** Truncate with ellipsis on word boundary when possible. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > max * 0.75 ? slice.slice(0, lastSpace) : slice) + "\u2026";
}

/**
 * Build the full advisory instruction sent as the first user turn of the
 * background feedback chat.
 */
export function buildFeedbackInstruction(msg: PersonaMessage, feedbackText: string): string {
  const topic = buildTopicMarker(msg);
  const contentExcerpt = truncate((msg.content ?? "").trim(), MAX_MESSAGE_EXCERPT);
  const feedback = truncate(feedbackText.trim(), MAX_FEEDBACK_LENGTH);
  const ts = msg.created_at;

  return [
    topic,
    "",
    `A user is giving you feedback on one of your recent outputs. Use this to understand where your response fell short and how you could improve your approach, configuration, or prompt next time.`,
    "",
    `## Original output (from ${ts})`,
    contentExcerpt || "(empty)",
    "",
    `## User feedback`,
    feedback,
    "",
    `## What I need from you`,
    `1. Acknowledge what the user pointed out.`,
    `2. Explain concretely what went wrong and why.`,
    `3. Propose specific, non-aggressive improvements to your system prompt, structured prompt sections, or persona parameters that would have produced a better result — preserve working behavior.`,
    `4. If the user's feedback is unclear, ask one focused follow-up question so we can iterate.`,
  ].join("\n");
}

/** Short display title for the feedback chat — used in process activity row and notifications. */
export function buildFeedbackChatTitle(msg: PersonaMessage): string {
  const subject = msg.title?.trim() || (msg.content ?? "").trim().slice(0, 50);
  const truncated = subject.length > 48 ? subject.slice(0, 47) + "\u2026" : subject;
  return `Feedback \u2014 ${truncated}`;
}
