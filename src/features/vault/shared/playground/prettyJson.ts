/**
 * Parse-then-reindent a raw JSON string for display. Falls back to the raw
 * string unchanged when it isn't valid JSON (e.g. still being typed, or a
 * non-JSON body). Single source of truth for this pattern — it was
 * previously reimplemented separately in EndpointRow, BuilderParams (used by
 * RequestBuilder), and ResponseViewer.
 */
export function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    // intentional: non-critical -- JSON parse fallback
    return raw;
  }
}
