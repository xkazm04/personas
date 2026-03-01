/**
 * StructuredPrompt — Canonical Owner Module
 *
 * Single source of truth for StructuredPrompt operations:
 * - Types & interfaces
 * - Creation & migration
 * - Parsing (JSON string → StructuredPrompt, Record → StructuredPrompt)
 * - Validation
 * - Serialization & persistence
 * - Rendering to markdown
 * - Section summaries & diffing helpers
 * - Editable format conversion (for draft editors)
 */

// ── Types ──────────────────────────────────────────────────────

export interface StructuredPromptSection {
  title: string;
  content: string;
}

export interface StructuredPrompt {
  identity: string;
  instructions: string;
  toolGuidance: string;
  examples: string;
  errorHandling: string;
  customSections: StructuredPromptSection[];
  webSearch: string;
}

/** Standard section keys (excluding customSections and webSearch) */
export const STANDARD_SECTION_KEYS = [
  'identity',
  'instructions',
  'toolGuidance',
  'examples',
  'errorHandling',
] as const;

export type StandardSectionKey = (typeof STANDARD_SECTION_KEYS)[number];

/** Human-readable labels for standard sections */
export const SECTION_LABELS: Record<StandardSectionKey, string> = {
  identity: 'Identity',
  instructions: 'Instructions',
  toolGuidance: 'Tool Guidance',
  examples: 'Examples',
  errorHandling: 'Error Handling',
};

// ── Creation & Migration ───────────────────────────────────────

/** Create an empty structured prompt with all fields initialized. */
export function createEmptyStructuredPrompt(): StructuredPrompt {
  return {
    identity: '',
    instructions: '',
    toolGuidance: '',
    examples: '',
    errorHandling: '',
    customSections: [],
    webSearch: '',
  };
}

/**
 * Migrate a flat prompt string into the structured format.
 * Places the entire flat text into the `instructions` section.
 */
export function migratePromptToStructured(flatPrompt: string): StructuredPrompt {
  return {
    ...createEmptyStructuredPrompt(),
    instructions: flatPrompt,
  };
}

// ── Validation ─────────────────────────────────────────────────

/** Check if all sections of a structured prompt are empty. */
export function isStructuredPromptEmpty(sp: StructuredPrompt): boolean {
  return (
    !sp.identity.trim() &&
    !sp.instructions.trim() &&
    !sp.toolGuidance.trim() &&
    !sp.examples.trim() &&
    !sp.errorHandling.trim() &&
    !sp.webSearch.trim() &&
    sp.customSections.every(s => !s.content.trim())
  );
}

// ── Parsing ────────────────────────────────────────────────────

/**
 * Normalize a custom section object, handling multiple heading field names
 * (title, label, name, key) that appear across different producers.
 */
function normalizeCustomSection(s: Record<string, unknown>): StructuredPromptSection {
  const title =
    typeof s.title === 'string' ? s.title
    : typeof s.label === 'string' ? s.label
    : typeof s.name === 'string' ? s.name
    : typeof s.key === 'string' ? s.key
    : '';
  return {
    title,
    content: typeof s.content === 'string' ? s.content : '',
  };
}

/** Parse a JSON string into a StructuredPrompt, returning null on failure. */
export function parseStructuredPrompt(json: string | null): StructuredPrompt | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return parseFromRecord(parsed);
  } catch {
    return null;
  }
}

/**
 * Convert a raw Record/object into a StructuredPrompt.
 * Handles all known field-name variations from design analysis, n8n transforms,
 * and template adoption.
 */
export function parseFromRecord(value: Record<string, unknown> | null | undefined): StructuredPrompt | null {
  if (!value || typeof value !== 'object') return null;

  // Must have at least an instructions field to be considered valid
  if (typeof value.instructions !== 'string') return null;

  const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');

  const rawCustom = Array.isArray(value.customSections) ? value.customSections : [];
  const customSections = rawCustom
    .filter((s: unknown): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map(normalizeCustomSection);

  return {
    identity: asStr(value.identity),
    instructions: asStr(value.instructions),
    toolGuidance: asStr(value.toolGuidance),
    examples: asStr(value.examples),
    errorHandling: asStr(value.errorHandling),
    webSearch: asStr(value.webSearch),
    customSections,
  };
}

// ── Serialization ──────────────────────────────────────────────

/** Serialize a StructuredPrompt to a JSON string for database persistence. */
export function stringifyStructuredPrompt(sp: StructuredPrompt): string {
  return JSON.stringify(sp);
}

// ── Rendering ──────────────────────────────────────────────────

/**
 * Render a StructuredPrompt to markdown, mirroring the Rust engine's
 * `assemble_prompt()` logic in `src-tauri/src/engine/prompt.rs`.
 *
 * Each non-empty section becomes a `## SectionName` heading.
 */
export function renderToMarkdown(sp: StructuredPrompt): string {
  const parts: string[] = [];

  if (sp.identity.trim()) {
    parts.push(`## Identity\n${sp.identity}`);
  }
  if (sp.instructions.trim()) {
    parts.push(`## Instructions\n${sp.instructions}`);
  }
  if (sp.toolGuidance.trim()) {
    parts.push(`## Tool Guidance\n${sp.toolGuidance}`);
  }
  if (sp.examples.trim()) {
    parts.push(`## Examples\n${sp.examples}`);
  }
  if (sp.errorHandling.trim()) {
    parts.push(`## Error Handling\n${sp.errorHandling}`);
  }

  for (const cs of sp.customSections) {
    if (cs.title.trim() && cs.content.trim()) {
      parts.push(`## ${cs.title}\n${cs.content}`);
    }
  }

  if (sp.webSearch.trim()) {
    parts.push(
      `## Web Search Research Prompt\nWhen performing web searches during this execution, use the following research guidance:\n\n${sp.webSearch}`,
    );
  }

  return parts.join('\n\n') + (parts.length ? '\n' : '');
}

// ── Section Summaries ──────────────────────────────────────────

/**
 * Extract short summaries (first 80 chars) for each standard section.
 * Used by prompt lab diff viewers and version displays.
 */
export function getSectionSummary(json: string | null): Record<string, string> {
  if (!json) return {};
  const parsed = parseStructuredPrompt(json);
  if (!parsed) return {};
  const result: Record<string, string> = {};
  for (const key of STANDARD_SECTION_KEYS) {
    const value = parsed[key];
    if (value) {
      result[SECTION_LABELS[key]] = value;
    }
  }
  return result;
}

// ── Editable Format (for draft editors) ────────────────────────

/** Custom section format used by draft editors (adds `key` and `label` fields). */
export type EditableCustomSection = {
  key: string;
  label: string;
  content: string;
};

/** Editable variant used by DraftPromptTab and N8n editors. */
export type EditableStructuredPrompt = {
  identity: string;
  instructions: string;
  toolGuidance: string;
  examples: string;
  errorHandling: string;
  webSearch: string;
  customSections: EditableCustomSection[];
};

/** Convert a raw Record (e.g., from a draft object) to EditableStructuredPrompt. */
export function toEditableStructuredPrompt(
  value: Record<string, unknown> | null,
): EditableStructuredPrompt {
  const src = value ?? {};
  const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');
  const rawCustom = Array.isArray(src.customSections) ? src.customSections : [];

  return {
    identity: asStr(src.identity),
    instructions: asStr(src.instructions),
    toolGuidance: asStr(src.toolGuidance),
    examples: asStr(src.examples),
    errorHandling: asStr(src.errorHandling),
    webSearch: asStr(src.webSearch),
    customSections: rawCustom
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
      .map((entry) => ({
        key: asStr(entry.key),
        label: asStr(entry.label || entry.title),
        content: asStr(entry.content),
      })),
  };
}

/** Convert EditableStructuredPrompt back to a plain Record for persistence. */
export function fromEditableStructuredPrompt(
  value: EditableStructuredPrompt,
): Record<string, unknown> {
  return {
    identity: value.identity,
    instructions: value.instructions,
    toolGuidance: value.toolGuidance,
    examples: value.examples,
    errorHandling: value.errorHandling,
    webSearch: value.webSearch,
    customSections: value.customSections
      .filter((section) => section.label.trim() || section.key.trim() || section.content.trim())
      .map((section) => ({
        key: section.key,
        label: section.label,
        content: section.content,
      })),
  };
}
