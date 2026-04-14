export interface InputSchemaField {
  key: string;
  type: string;
  label: string;
}

export interface InputSchemaResult {
  fields: InputSchemaField[];
  parseError: string | null;
}

export function parseTags(tags: string | null | undefined): string[] {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

export interface SchemaFieldParsed {
  key: string;
  type: string;
  label: string;
  default?: string;
}

export function parseSchemaFields(raw: string | null | undefined): SchemaFieldParsed[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((f: Record<string, unknown>) => ({
      key: String(f.key ?? ''),
      type: String(f.type ?? 'text'),
      label: String(f.label ?? ''),
      default: f.default != null ? String(f.default) : '',
    }));
  } catch {
    return [];
  }
}

export function parseInputSchema(schema: string | null): InputSchemaResult {
  if (!schema) return { fields: [], parseError: null };
  try {
    const parsed = JSON.parse(schema);
    return { fields: Array.isArray(parsed) ? parsed : [], parseError: null };
  } catch (e) {
    return { fields: [], parseError: e instanceof Error ? e.message : String(e) };
  }
}
