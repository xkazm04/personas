/**
 * Extraction's product claim is typed rows an operator can count and take
 * elsewhere. Inside the modal an attribute blob is a wrapped soup of
 * key:value pairs: uncountable, unsortable, un-pasteable. Flattening each
 * attribute into its own column is what makes "how many F-type footings?" a
 * spreadsheet question.
 *
 * `entityKey` is exported as its own column deliberately: two surface forms of
 * the same object (a split, or a collision) are obvious in a sorted sheet and
 * invisible in a scrolling table.
 */
import type { KbEntity } from '@/api/vault/database/vectorKb';

/** Fixed leading columns; attribute columns follow, sorted, one per key. */
export const ENTITY_CSV_BASE_COLUMNS = [
  'entity_type',
  'entity_key',
  'document',
  'page',
  'confidence',
] as const;

/** Distinct entity types present in a set, in stable alphabetical order. */
export function distinctEntityTypes(entities: KbEntity[]): string[] {
  return Array.from(new Set(entities.map((e) => e.entityType).filter(Boolean))).sort();
}

function attributesOf(entity: KbEntity): Record<string, unknown> {
  const attrs = entity.attributes;
  return attrs && typeof attrs === 'object' && !Array.isArray(attrs)
    ? (attrs as Record<string, unknown>)
    : {};
}

/** Union of attribute keys across the set, so every row has the same columns. */
export function attributeColumns(entities: KbEntity[]): string[] {
  const keys = new Set<string>();
  for (const e of entities) for (const k of Object.keys(attributesOf(e))) keys.add(k);
  return Array.from(keys).sort();
}

function cellValue(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

/**
 * RFC 4180 quoting: a field is quoted when it holds a comma, a quote, a
 * newline or leading/trailing whitespace, and embedded quotes are doubled.
 * A leading `=`/`+`/`-`/`@` is prefixed with a single quote so a spreadsheet
 * treats an extracted value as text rather than as a formula.
 */
export function csvCell(value: unknown): string {
  let s = cellValue(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s) || s !== s.trim()) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** The visible set as CSV: fixed columns then one column per attribute key. */
export function toEntityCsv(entities: KbEntity[]): string {
  const attrCols = attributeColumns(entities);
  const header = [...ENTITY_CSV_BASE_COLUMNS, ...attrCols];
  const rows = entities.map((e) => {
    const attrs = attributesOf(e);
    return [
      csvCell(e.entityType),
      csvCell(e.entityKey),
      csvCell(e.documentTitle),
      csvCell(e.sourcePage),
      csvCell(e.extractionConfidence),
      ...attrCols.map((k) => csvCell(attrs[k])),
    ].join(',');
  });
  return [header.join(','), ...rows].join('\r\n');
}

/** The visible set as JSON, for an operator piping it somewhere typed. */
export function toEntityJson(entities: KbEntity[]): string {
  return JSON.stringify(
    entities.map((e) => ({
      entityType: e.entityType,
      entityKey: e.entityKey,
      document: e.documentTitle,
      page: e.sourcePage,
      confidence: e.extractionConfidence,
      attributes: attributesOf(e),
    })),
    null,
    2,
  );
}

/** Filename stem for an export, narrowed by the active type filter. */
export function entityExportFilename(kbName: string, entityType: string | null, ext: string): string {
  const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const parts = [slug(kbName) || 'knowledge-base', 'entities'];
  if (entityType) parts.push(slug(entityType));
  return `${parts.join('-')}.${ext}`;
}

/** Hand the blob to the browser's download path. */
export function downloadTextFile(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
