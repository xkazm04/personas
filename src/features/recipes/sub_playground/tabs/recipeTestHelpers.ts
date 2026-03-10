export interface InputField {
  key: string;
  type: string;
  label: string;
  default?: unknown;
  options?: string[];
}

export function parseInputSchema(schema: string | null): InputField[] {
  if (!schema) return [];
  try {
    const parsed = JSON.parse(schema);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
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
