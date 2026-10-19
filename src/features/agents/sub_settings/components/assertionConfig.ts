/**
 * The `config` JSON the engine deserializes for each assertion type the
 * settings section can create.
 *
 * TETHERED to `src-tauri/engine/src/output_assertions.rs`: `contains` reads
 * `ContainsConfig { phrases, match_all, case_sensitive }` and `not_contains`
 * reads `NotContainsConfig { patterns, case_sensitive }`. A wrong key does not
 * fail at create time (the command stores the string unparsed); it fails on
 * EVERY run as "Invalid not_contains config", which counts as a failed
 * assertion and fires its on-failure action (a manual review by default).
 * `assertionConfig.test.ts` reads the Rust structs so the keys cannot drift.
 */
export type SettingsAssertionType = 'contains' | 'not_contains';

/** Split the comma-separated phrase field into trimmed, non-empty phrases. */
export function parsePhrases(raw: string): string[] {
  return raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}

export function assertionConfigJson(type: SettingsAssertionType, phrases: readonly string[]): string {
  return type === 'not_contains'
    ? JSON.stringify({ patterns: phrases, case_sensitive: false })
    : JSON.stringify({ phrases, case_sensitive: false });
}
