/**
 * Tag -> SurfaceSpec block. Pure.
 *
 * A block tag in a markdown document is read into the SAME `SurfaceBlock` a
 * surface would carry and validated by the SAME schema, so the markdown tags
 * cannot grow a dialect of their own. The tag names are chosen for the person
 * writing prose (`stats`, not `stat_row`); everything past the name is the
 * SurfaceSpec contract documented in `surface/SPEC.md`.
 *
 *   :::stats            body: a ```json fence, an array of stats (or {stats})
 *   :::table{title}     body: a ```json fence, {columns, rows}
 *   :::decisions        body: a ```json fence, an array of items (or {items})
 *   :::terminal{title}  body: any fence, one output line per line
 *   ::gauge{label value hint}      value 0-100
 *   ::progress{label value hint}   value 0-100
 */
import { surfaceBlockSchema, type SurfaceBlock } from '../surface/surfaceSpec';

export type RichBlockResult = { ok: true; block: SurfaceBlock } | { ok: false; reason: string };

function parseJson(body: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  if (!body.trim()) return { ok: false, reason: 'empty body' };
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'invalid JSON' };
  }
}

/** `[...]` or `{ key: [...] }` - both spellings of a list body are accepted. */
function listFrom(value: unknown, key: string): unknown {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object' && key in value) return (value as Record<string, unknown>)[key];
  return value;
}

function validate(candidate: Record<string, unknown>): RichBlockResult {
  const parsed = surfaceBlockSchema.safeParse(candidate);
  if (parsed.success) return { ok: true, block: parsed.data };
  const issue = parsed.error.issues[0];
  const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
  return { ok: false, reason: `${where}${issue?.message ?? 'does not match the schema'}` };
}

export function readRichBlock(
  name: string,
  attrs: Record<string, string>,
  body: string,
): RichBlockResult {
  switch (name) {
    case 'stats': {
      const json = parseJson(body);
      if (!json.ok) return json;
      return validate({ type: 'stat_row', stats: listFrom(json.value, 'stats') });
    }
    case 'table': {
      const json = parseJson(body);
      if (!json.ok) return json;
      const value = json.value && typeof json.value === 'object' ? (json.value as Record<string, unknown>) : {};
      return validate({ type: 'table', title: attrs.title, ...value });
    }
    case 'decisions': {
      const json = parseJson(body);
      if (!json.ok) return json;
      return validate({ type: 'decisions', title: attrs.title, items: listFrom(json.value, 'items') });
    }
    case 'terminal':
      return validate({
        type: 'terminal',
        title: attrs.title,
        lines: body.length ? body.replace(/\n$/, '').split('\n') : [],
      });
    case 'gauge':
    case 'progress':
      return validate({ type: name, label: attrs.label, value: attrs.value, hint: attrs.hint });
    default:
      return { ok: false, reason: `unknown block "${name}"` };
  }
}
