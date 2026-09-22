/**
 * Shared types for the unified inbox adapters.
 *
 * `PersonaSummary` is the projection of a `Persona` that adapters consume —
 * just the fields that need to land on every UnifiedInboxItem regardless of
 * source (manualReview / message / healing).
 */
export interface PersonaSummary {
  personaName: string;
  personaIcon: string | null;
  personaColor: string | null;
}
