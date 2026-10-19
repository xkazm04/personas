/**
 * Ids of the deployment that is CURRENT for each persona in a newest-first
 * history list (the order `list_by_project` / `list_by_persona_project` return).
 *
 * The tab used to mark only `history[0]` current. With the "All personas"
 * filter the list mixes personas, so every other persona's live deployment was
 * shown as an old one, without the Current badge and WITH a Rollback button
 * that "rolls back" to what is already deployed.
 */
export function currentDeploymentIds(
  history: ReadonlyArray<{ id: string; personaId: string }>,
): Set<string> {
  const seen = new Set<string>();
  const current = new Set<string>();
  for (const record of history) {
    if (seen.has(record.personaId)) continue;
    seen.add(record.personaId);
    current.add(record.id);
  }
  return current;
}
