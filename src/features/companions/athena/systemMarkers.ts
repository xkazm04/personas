/**
 * System episodes that are pure PROVENANCE, not content.
 *
 * The backend persists a few `role: 'system'` rows whose whole job is to mark
 * how the next turn began — `[autonomous continuation #3]`, `[Fleet]`,
 * `[proactive: incident]`. They carry no prose a user would read, so the
 * transcript renders them as slim dividers (or, for `proactive`, not at all —
 * the assistant reply that follows IS what the user reads).
 *
 * The predicate lives here, in one place, because two components branch on it:
 * `Bubble` (which draws the dividers) and `AthenaChatMessageRow` (which has to
 * leave marker rows alone when routing everything else to the system-note
 * treatment). Duplicating the regexes is how they drift.
 *
 * **The `fleet` pattern is anchored at both ends; the other two are not, and
 * that asymmetry is deliberate.** `fleet_bridge.rs` writes TWO different things
 * behind the same tag: a bare `[Fleet]` provenance marker, and a completion
 * report — `[Fleet] athena-scan-sweep finished — No pending question…`. Six of
 * the latter are in the live DB, and a prefix match sent every one of them to
 * the divider branch, where a multi-sentence report of what a session actually
 * did rendered as a caption-sized label (with a stray `]`, because the strip
 * regex is anchored to the end of the string). Anchoring `fleet` means a tag
 * with prose after it is content, and content reaches `AthenaChatSystemNote`
 * where it can be read.
 *
 * `autonomous` and `proactive` stay prefix matches. Their writers
 * (`session.rs:555,559`) emit the tag and nothing else, so there is no measured
 * ambiguity to resolve — and `Bubble`'s own test asserts that trailing text on
 * an autonomous marker is still a marker. Anchor what is proven broken; leave
 * what is proven fine.
 */

export type SystemMarker = 'autonomous' | 'fleet' | 'proactive';

/** Which marker a system body is, or null when it carries real content. */
export function systemMarkerOf(content: string): SystemMarker | null {
  const text = content.trim();
  if (text.startsWith('[autonomous continuation')) return 'autonomous';
  // Anchored — see the header. `[Fleet]` is a marker; `[Fleet] …` is a message.
  if (/^\[fleet\]$/i.test(text)) return 'fleet';
  if (/^\[proactive:/i.test(text)) return 'proactive';
  return null;
}
