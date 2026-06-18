/**
 * First letters of the first two words of a persona name, uppercased — the
 * fallback `PersonaIcon` / `PersonaGlyph` render when a persona has no assigned
 * icon. Strips a leading `T:` team prefix. Returns `?` for a blank name.
 *
 * `"Ada Lovelace"` → `"AL"`, `"Athena"` → `"A"`, `""` → `"?"`.
 *
 * Lives next to {@link resolvePersonaIcon} (the icon classifier) so the
 * fallback helper is reachable from any renderer without pulling in a feature
 * module.
 */
export function personaInitials(name: string): string {
  const words = name.replace(/^T:\s*/, '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 1).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}
