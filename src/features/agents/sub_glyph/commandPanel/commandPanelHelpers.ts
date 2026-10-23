/**
 * Recipe requirement parsing for the glyph compose surfaces.
 *
 * This file used to carry the legacy command-panel composer's helpers (intent
 * rows, compose/parse of `Label: ` sections, recipe pre-fill, a third copy of
 * the cell-key -> dimension map, a schedule chip label). That composer was
 * deleted with the Sheet · Cinema consolidation and its helpers had no
 * production caller left; the one function still in use lives on here.
 */

/**
 * Parse a recipe's JSON requirement blob (tool_requirements,
 * credential_requirements, …) into a flat name list. The field is
 * JSON-encoded (per `db::models::recipe::RecipeDefinition`) and is usually
 * a `string[]` like `["http_request", "file_read"]`, but has also shown up
 * as an array of objects (`{name}` / `{service_type}` / `{connector}`), or
 * an object with a `connectors` array. We accept any of those shapes and
 * quietly drop entries that don't match — a malformed tag entry shouldn't
 * block the entire list.
 */
export function parseRecipeNameList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.connectors)
        ? parsed.connectors
        : [];
    const out: string[] = [];
    for (const entry of arr) {
      const name =
        typeof entry === "string"
          ? entry
          : entry && typeof entry === "object"
            ? String(entry.name ?? entry.service_type ?? entry.connector ?? "")
            : "";
      if (name) out.push(name);
    }
    return out;
  } catch {
    return [];
  }
}
