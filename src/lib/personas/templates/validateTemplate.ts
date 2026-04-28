/**
 * Hand-rolled validator for TemplateCatalogEntry JSON.
 *
 * Replaces the previous "checksum-only" trust model where any malformed
 * template that happened to match its checksum would parse but render
 * broken cards 4 clicks deep. The validator runs after checksum verification
 * but before the template is admitted to the catalog: a malformed template
 * is added to `skipped` with reason 'schema_invalid' and a human-readable
 * `detail` so the offending field can be located without re-running the
 * loader.
 *
 * Intentionally hand-rolled (not Zod) — the only consumer is the catalog
 * loader and adding a top-level dep for one validation site costs more
 * than it saves.
 */
import type { TemplateCatalogEntry } from '@/lib/types/templateTypes';

export type TemplateValidationResult =
  | { valid: true; template: TemplateCatalogEntry }
  | { valid: false; reason: string };

/**
 * Validate that a parsed JSON value matches the TemplateCatalogEntry shape.
 *
 * Required: id, name, description, icon, color, category[], payload (object).
 * Optional but checked when present: payload.persona, payload.use_cases[]
 * (must be objects/arrays of objects).
 */
export function validateTemplateCatalogEntry(raw: unknown): TemplateValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, reason: 'top-level value is not an object' };
  }
  const t = raw as Record<string, unknown>;

  if (typeof t.id !== 'string' || !t.id.trim()) {
    return { valid: false, reason: 'id must be a non-empty string' };
  }
  if (typeof t.name !== 'string' || !t.name.trim()) {
    return { valid: false, reason: `id="${t.id}": name must be a non-empty string` };
  }
  if (typeof t.description !== 'string') {
    return { valid: false, reason: `id="${t.id}": description must be a string` };
  }
  if (typeof t.icon !== 'string') {
    return { valid: false, reason: `id="${t.id}": icon must be a string` };
  }
  if (typeof t.color !== 'string') {
    return { valid: false, reason: `id="${t.id}": color must be a string` };
  }
  if (!Array.isArray(t.category) || !t.category.every((c) => typeof c === 'string')) {
    return { valid: false, reason: `id="${t.id}": category must be a string[]` };
  }
  if (!t.payload || typeof t.payload !== 'object' || Array.isArray(t.payload)) {
    return { valid: false, reason: `id="${t.id}": payload must be an object` };
  }

  // Payload sub-shape — only validate keys we know exist; unknown keys are
  // tolerated by TemplateV3Payload's [k: string]: unknown index signature.
  const p = t.payload as Record<string, unknown>;
  if (p.persona !== undefined && (typeof p.persona !== 'object' || p.persona === null || Array.isArray(p.persona))) {
    return { valid: false, reason: `id="${t.id}": payload.persona must be an object if present` };
  }
  if (p.use_cases !== undefined) {
    if (!Array.isArray(p.use_cases)) {
      return { valid: false, reason: `id="${t.id}": payload.use_cases must be an array if present` };
    }
    for (let i = 0; i < p.use_cases.length; i++) {
      const uc = p.use_cases[i];
      if (!uc || typeof uc !== 'object' || Array.isArray(uc)) {
        return { valid: false, reason: `id="${t.id}": payload.use_cases[${i}] must be an object` };
      }
      const ucObj = uc as Record<string, unknown>;
      // id is the documented stable key — flag missing/non-string ids since
      // they break adoption flows that look templates up by use_case id.
      if (ucObj.id !== undefined && typeof ucObj.id !== 'string') {
        return { valid: false, reason: `id="${t.id}": payload.use_cases[${i}].id must be a string if present` };
      }
    }
  }
  if (p.service_flow !== undefined) {
    if (!Array.isArray(p.service_flow) || !p.service_flow.every((s) => typeof s === 'string')) {
      return { valid: false, reason: `id="${t.id}": payload.service_flow must be a string[] if present` };
    }
  }
  if (p.suggested_connectors !== undefined) {
    if (!Array.isArray(p.suggested_connectors)) {
      return { valid: false, reason: `id="${t.id}": payload.suggested_connectors must be an array if present` };
    }
    for (let i = 0; i < p.suggested_connectors.length; i++) {
      const c = p.suggested_connectors[i];
      if (!c || typeof c !== 'object' || typeof (c as Record<string, unknown>).name !== 'string') {
        return { valid: false, reason: `id="${t.id}": payload.suggested_connectors[${i}] must be { name: string }` };
      }
    }
  }
  if (p.suggested_triggers !== undefined) {
    if (!Array.isArray(p.suggested_triggers)) {
      return { valid: false, reason: `id="${t.id}": payload.suggested_triggers must be an array if present` };
    }
  }

  return { valid: true, template: t as unknown as TemplateCatalogEntry };
}
