/**
 * Shared types for the Simple-mode inbox adapters.
 *
 * `PersonaSummary` is the projection of a `Persona` that adapters consume —
 * just the fields that need to land on every UnifiedInboxItem regardless
 * of source (manualReview / message / healing). Hoisted from per-adapter
 * declarations so a future field rename only happens in one place.
 */
export interface PersonaSummary {
  personaName: string;
  personaIcon: string | null;
  personaColor: string | null;
}
