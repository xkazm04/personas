export interface InputField {
  key: string;
  type: string;
  label: string;
  default?: unknown;
  options?: string[];
}

export interface InputFieldResult {
  fields: InputField[];
  parseError: string | null;
}

export function parseInputSchema(schema: string | null): InputFieldResult {
  if (!schema) return { fields: [], parseError: null };
  try {
    const parsed = JSON.parse(schema);
    return { fields: Array.isArray(parsed) ? parsed : [], parseError: null };
  } catch (e) {
    return { fields: [], parseError: e instanceof Error ? e.message : String(e) };
  }
}

export function parseMockValues(sampleInputs: string | null): Record<string, unknown> | null {
  if (!sampleInputs) return null;
  try {
    const parsed = JSON.parse(sampleInputs);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

export function formatOutputForMarkdown(output: string): string {
  const trimmed = output.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      const formatted = JSON.stringify(JSON.parse(trimmed), null, 2);
      return '```json\n' + formatted + '\n```';
    } catch {
      // intentional: non-critical - JSON parse fallback
    }
  }
  return trimmed;
}
