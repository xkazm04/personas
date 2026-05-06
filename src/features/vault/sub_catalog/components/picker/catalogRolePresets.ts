/**
 * @deprecated The `ROLE_PRESETS` map (developer/support/manager → categories)
 * has been retired. Audience tags now live per-connector in
 * `lib/credentials/connectorAudiences.ts` (and ultimately in each builtin
 * connector's `metadata.audiences`). The picker derives presets emergently
 * via `connectorMatchesAudience` rather than through a hand-authored
 * category map.
 *
 * Only the `RolePreset` type remains so existing imports of the user-facing
 * audience values keep compiling. Prefer `Audience` from
 * `@/lib/credentials/connectorAudiences` for new code.
 */
export type RolePreset = 'developer' | 'support' | 'manager';
