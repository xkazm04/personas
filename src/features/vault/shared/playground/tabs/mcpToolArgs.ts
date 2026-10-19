/**
 * Turn the MCP tool form's text fields into the arguments object a tool call
 * sends, typed by the tool's own input schema.
 *
 * Every field used to go through `JSON.parse` whatever its declared type, so a
 * `string` parameter typed as `123`, `true`, `null` or `"quoted"` reached the
 * server as a number, a boolean, null or a de-quoted string, and a schema-checking
 * server refused the call for an input the operator typed correctly. Strings now
 * stay strings; only the types that need parsing are parsed.
 */
type PropSchema = { type?: unknown };

export function buildToolArgs(
  inputSchema: unknown,
  values: Record<string, string>,
): Record<string, unknown> {
  const properties = (
    inputSchema && typeof inputSchema === 'object'
      ? (inputSchema as { properties?: Record<string, PropSchema> }).properties
      : undefined
  ) ?? {};
  const args: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(values)) {
    if (!raw.trim()) continue;
    const type = properties[key]?.type;
    if (type === 'string') {
      args[key] = raw;
    } else if (type === 'number' || type === 'integer') {
      const n = Number(raw.trim());
      args[key] = Number.isFinite(n) ? n : raw;
    } else if (type === 'boolean') {
      const v = raw.trim();
      args[key] = v === 'true' ? true : v === 'false' ? false : raw;
    } else {
      // object, array, a union or an undeclared type: JSON when it parses,
      // the text itself otherwise, so the server names what it expected.
      try { args[key] = JSON.parse(raw); } catch { args[key] = raw; }
    }
  }
  return args;
}
