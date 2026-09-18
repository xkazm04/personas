/**
 * Credential field schemas for a connector an import SUGGESTED.
 *
 * The shared extraction pipeline emitted `credential_fields: []` for every
 * suggested connector, so an importer received connector NAMES with no keys to
 * fill: the n8n wizard's connectors-missing gate could say "you need Slack"
 * and nothing more, and the vault was handed a name-only credential.
 *
 * The fields come from `BUILTIN_CONNECTORS` - the committed catalog the vault
 * itself builds its forms from - keyed by the same `name` the parsers emit as
 * a service. Deliberately NOT a second hand-written table: a private map here
 * would drift from the catalog the moment a connector's auth changed, and the
 * import would then ask for a key the vault does not store.
 *
 * An unknown service yields `[]`, unchanged. This never invents a field.
 */
import { BUILTIN_CONNECTORS } from '@/lib/credentials/builtinConnectors';

/** The field shape the extraction pipeline emits on a suggested connector. */
export interface SuggestedCredentialField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'url';
  placeholder?: string;
  helpText?: string;
  required?: boolean;
}

const BY_NAME = new Map(BUILTIN_CONNECTORS.map((c) => [c.name, c]));

/**
 * The control kinds an offline import can render. Declared as a set rather
 * than a chain of `=== 'text'` comparisons so the vocabulary has one name and
 * both the filter and its test read from it (golden path `schema-driven-form`:
 * a recognised-type list written out by hand beside its consumer drifts from
 * the declaration it is supposed to follow).
 */
export const IMPORTABLE_FIELD_TYPES = new Set<SuggestedCredentialField['type']>([
  'text',
  'password',
  'url',
]);

function isImportable(type: string): type is SuggestedCredentialField['type'] {
  return IMPORTABLE_FIELD_TYPES.has(type as SuggestedCredentialField['type']);
}

/**
 * The catalog's fields for a service, narrowed to the three input types an
 * import form can render. A `select` field needs its option list resolved
 * against live data (a twin id, a workspace), which an offline import cannot
 * do, so it is dropped rather than shipped unfillable.
 */
export function credentialFieldsForService(service: string): SuggestedCredentialField[] {
  const def = BY_NAME.get(service);
  if (!def) return [];
  const out: SuggestedCredentialField[] = [];
  for (const f of def.fields) {
    if (!isImportable(f.type)) continue;
    out.push({
      key: f.key,
      label: f.label,
      type: f.type,
      ...(f.placeholder ? { placeholder: f.placeholder } : {}),
      ...(f.helpText ? { helpText: f.helpText } : {}),
      ...(f.required !== undefined ? { required: f.required } : {}),
    });
  }
  return out;
}
