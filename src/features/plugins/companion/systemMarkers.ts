/**
 * System episodes that are pure PROVENANCE, not content.
 *
 * The backend persists a few `role: 'system'` rows whose whole job is to mark
 * how the next turn began — `[autonomous continuation #3]`, `[Fleet]`,
 * `[proactive: incident]`. They carry no prose a user would read, so the
 * transcript renders them as slim dividers (or, for `proactive`, not at all —
 * the assistant reply that follows IS what the user reads).
 *
 * The predicate lives here, in one place, because two components now branch on
 * it: `Bubble` (which draws the dividers) and `AthenaChatMessageRow` (which has
 * to leave marker rows alone when routing everything else to the system-note
 * treatment). Duplicating the regexes is how they drift.
 */

export type SystemMarker = 'autonomous' | 'fleet' | 'proactive';

/** Which marker a system body is, or null when it carries real content. */
export function systemMarkerOf(content: string): SystemMarker | null {
  const text = content.trim();
  if (text.startsWith('[autonomous continuation')) return 'autonomous';
  if (/^\[fleet\b/i.test(text)) return 'fleet';
  if (/^\[proactive:/i.test(text)) return 'proactive';
  return null;
}
