import type { CredentialTemplateField } from '@/lib/types/types';

export interface HealthcheckConfig {
  endpoint: string;
  method: string;
  headers: Record<string, string>;
  description: string;
}

export interface SchemaSubType {
  id: string;
  label: string;
  displayLabel?: string;
  description: string;
  color?: string;
  fields: CredentialTemplateField[];
  healthcheck?: (values: Record<string, string>) => HealthcheckConfig | null;
  testHint?: string;
  noHealthcheckHint?: string;
}

export type ExtraFieldDef =
  | { kind: 'textarea'; key: string; sectionTitle: string; placeholder: string; helpText?: string; rows?: number }
  | { kind: 'checkbox'; key: string; label: string }
  | { kind: 'key-value-list'; key: string; sectionTitle: string; addLabel?: string; emptyMessage?: string; addButtonClass?: string };

export interface SchemaFormConfig {
  headerIcon: React.ReactNode;
  title: string;
  subtitle: string;
  nameLabel: string;
  namePlaceholder: string;
  subTypeLabel: string;
  subTypes: SchemaSubType[];
  subTypeLayout: 'flex' | 'grid';
  subTypeActiveClass: string;
  serviceTypePrefix: string;
  category: string;
  connectorColor: string;
  healthKey: string;
  subTypeMetadataKey: string;
  extraFields?: ExtraFieldDef[];
  buildExtraMetadata?: (subTypeId: string, extras: Record<string, unknown>) => Record<string, unknown>;
  buildExtraCredData?: (subTypeId: string, extras: Record<string, unknown>) => Record<string, string>;
}

export function sanitize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

export function buildEnvMap(extras: Record<string, unknown>): Record<string, string> {
  const pairs = (extras.env_vars as { key: string; value: string }[]) ?? [];
  const map: Record<string, string> = {};
  for (const ev of pairs) {
    if (ev.key.trim()) map[ev.key.trim()] = ev.value;
  }
  return map;
}

export function buildCustomHealthcheck(
  template: string,
  values: Record<string, string>,
): HealthcheckConfig | null {
  const baseUrl = values.base_url?.trim();
  if (!baseUrl) return null;
  const headers: Record<string, string> = {};
  switch (template) {
    case 'api-key': {
      const headerName = values.header_name?.trim() || 'X-API-Key';
      headers[headerName] = '{{api_key}}';
      break;
    }
    case 'bearer':
      headers['Authorization'] = 'Bearer {{bearer_token}}';
      break;
    case 'basic': {
      const u = values.username ?? '';
      const p = values.password ?? '';
      headers['Authorization'] = `Basic ${btoa(`${u}:${p}`)}`;
      break;
    }
    case 'custom-headers':
      if (values.header_1_name?.trim()) headers[values.header_1_name.trim()] = '{{header_1_value}}';
      if (values.header_2_name?.trim()) headers[values.header_2_name.trim()] = '{{header_2_value}}';
      break;
  }
  return { endpoint: baseUrl, method: 'GET', headers, description: 'Healthcheck for custom connection' };
}
