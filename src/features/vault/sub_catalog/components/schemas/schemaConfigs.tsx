import { Server, Link, Database } from 'lucide-react';
import type { SchemaFormConfig } from './schemaFormTypes';
import { buildEnvMap, buildCustomHealthcheck } from './schemaFormTypes';
import { healthcheckMcpPreview } from '@/api/agents/mcpTools';
import type { Translations } from '@/i18n/en';

// Schemas are factory functions so each schema's prose, labels, and helpText
// resolve through the active translation bundle. Importers call
// `getMcpSchema(t)` (etc.) inside a component that already has access to
// `useTranslation()`.

export function getMcpSchema(t: Translations): SchemaFormConfig {
  const s = t.vault.schema_configs.mcp;
  return {
    headerIcon: (
      <div className="w-9 h-9 rounded-card bg-cyan-500/10 border border-cyan-500/25 flex items-center justify-center">
        <Server className="w-[1.125rem] h-[1.125rem] text-cyan-400" />
      </div>
    ),
    title: s.title,
    subtitle: s.subtitle,
    nameLabel: s.name_label,
    namePlaceholder: s.name_placeholder,
    subTypeLabel: s.subtype_label,
    subTypes: [
      {
        id: 'stdio',
        displayLabel: s.subtype_stdio_display,
        label: 'stdio',
        description: s.subtype_stdio_description,
        fields: [
          { key: 'command', label: s.field_command_label, type: 'text', required: true, placeholder: 'npx -y @modelcontextprotocol/server-filesystem', helpText: s.field_command_help },
          { key: 'working_directory', label: s.field_working_dir_label, type: 'text', required: false, placeholder: '/home/user/project', helpText: s.field_working_dir_help },
        ],
        testHint: s.subtype_stdio_test_hint,
      },
      {
        id: 'sse',
        displayLabel: s.subtype_sse_display,
        label: 'sse',
        description: s.subtype_sse_description,
        fields: [
          { key: 'url', label: s.field_url_label, type: 'url', required: true, placeholder: 'https://mcp.example.com/sse', helpText: s.field_url_help },
          { key: 'auth_token', label: s.field_auth_token_label, type: 'password', required: false, placeholder: 'Bearer token or API key', helpText: s.field_auth_token_help },
        ],
        testHint: s.subtype_sse_test_hint,
      },
    ],
    subTypeLayout: 'flex',
    subTypeActiveClass: 'bg-cyan-500/15 border-cyan-500/30 text-cyan-300',
    serviceTypePrefix: 'mcp',
    category: 'mcp',
    connectorColor: '#06B6D4',
    healthKey: 'mcp-server',
    subTypeMetadataKey: 'connection_type',
    extraFields: [
      {
        kind: 'key-value-list',
        key: 'env_vars',
        sectionTitle: s.env_vars_section,
        addLabel: s.env_vars_add,
        emptyMessage: s.env_vars_empty,
        addButtonClass: 'text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/15 border-cyan-500/20',
      },
    ],
    buildExtraMetadata: (_subTypeId, extras) => ({
      env_vars: buildEnvMap(extras),
    }),
    buildExtraCredData: (subTypeId, extras) => {
      const result: Record<string, string> = { connection_type: subTypeId };
      const envMap = buildEnvMap(extras);
      if (Object.keys(envMap).length > 0) result.env_vars = JSON.stringify(envMap);
      return result;
    },
    customHealthcheck: async (subTypeId, fieldValues, extras) => {
      const fields: Record<string, string> = { ...fieldValues, connection_type: subTypeId };
      const envMap = buildEnvMap(extras);
      if (Object.keys(envMap).length > 0) fields.env_vars = JSON.stringify(envMap);
      return healthcheckMcpPreview(fields);
    },
  };
}

export function getCustomSchema(t: Translations): SchemaFormConfig {
  const s = t.vault.schema_configs.custom;
  return {
    headerIcon: (
      <div className="w-9 h-9 rounded-card bg-amber-500/10 border border-amber-500/25 flex items-center justify-center">
        <Link className="w-[1.125rem] h-[1.125rem] text-amber-400" />
      </div>
    ),
    title: s.title,
    subtitle: s.subtitle,
    nameLabel: s.name_label,
    namePlaceholder: s.name_placeholder,
    subTypeLabel: s.subtype_label,
    subTypes: [
      {
        id: 'api-key', label: s.subtype_api_key_label, description: s.subtype_api_key_description,
        fields: [
          { key: 'base_url', label: s.field_base_url_label, type: 'url', required: true, placeholder: 'https://api.example.com', helpText: s.field_base_url_help },
          { key: 'api_key', label: s.field_api_key_label, type: 'password', required: true, placeholder: 'sk-...', helpText: s.field_api_key_help },
          { key: 'header_name', label: s.field_header_name_label, type: 'text', required: false, placeholder: 'X-API-Key', helpText: s.field_header_name_help },
        ],
        healthcheck: (values) => buildCustomHealthcheck('api-key', values),
      },
      {
        id: 'bearer', label: s.subtype_bearer_label, description: s.subtype_bearer_description,
        fields: [
          { key: 'base_url', label: s.field_base_url_label, type: 'url', required: true, placeholder: 'https://api.example.com', helpText: s.field_base_url_help },
          { key: 'bearer_token', label: s.field_bearer_token_label, type: 'password', required: true, placeholder: 'eyJ...', helpText: s.field_bearer_token_help },
        ],
        healthcheck: (values) => buildCustomHealthcheck('bearer', values),
      },
      {
        id: 'basic', label: s.subtype_basic_label, description: s.subtype_basic_description,
        fields: [
          { key: 'base_url', label: s.field_base_url_label, type: 'url', required: true, placeholder: 'https://api.example.com', helpText: s.field_base_url_help },
          { key: 'username', label: s.field_username_label, type: 'text', required: true, placeholder: 'user@example.com' },
          { key: 'password', label: s.field_password_label, type: 'password', required: true, placeholder: 'password' },
        ],
        healthcheck: (values) => buildCustomHealthcheck('basic', values),
      },
      {
        id: 'custom-headers', label: s.subtype_custom_headers_label, description: s.subtype_custom_headers_description,
        fields: [
          { key: 'base_url', label: s.field_base_url_label, type: 'url', required: true, placeholder: 'https://api.example.com', helpText: s.field_base_url_help },
          { key: 'header_1_name', label: s.field_header_n_name_label.replace('{n}', '1'), type: 'text', required: true, placeholder: 'X-Custom-Key' },
          { key: 'header_1_value', label: s.field_header_n_value_label.replace('{n}', '1'), type: 'password', required: true, placeholder: 'value' },
          { key: 'header_2_name', label: s.field_header_n_name_label.replace('{n}', '2'), type: 'text', required: false, placeholder: 'X-Custom-Secret' },
          { key: 'header_2_value', label: s.field_header_n_value_label.replace('{n}', '2'), type: 'password', required: false, placeholder: 'value' },
        ],
        healthcheck: (values) => buildCustomHealthcheck('custom-headers', values),
      },
    ],
    subTypeLayout: 'grid',
    subTypeActiveClass: 'bg-amber-500/15 border-amber-500/30 text-amber-300',
    serviceTypePrefix: 'custom',
    category: 'custom',
    connectorColor: '#F59E0B',
    healthKey: 'custom-connection',
    subTypeMetadataKey: 'auth_template',
    extraFields: [
      {
        kind: 'textarea',
        key: 'openapi_spec_url',
        sectionTitle: s.openapi_section,
        placeholder: 'https://petstore3.swagger.io/api/v3/openapi.json',
        helpText: s.openapi_help,
        rows: 1,
      },
      {
        kind: 'textarea',
        key: 'api_definition',
        sectionTitle: s.api_definition_section,
        placeholder: s.api_definition_placeholder,
        helpText: s.api_definition_help,
        rows: 4,
      },
    ],
    buildExtraMetadata: (_subTypeId, extras) => {
      const def = (extras.api_definition as string)?.trim();
      const specUrl = (extras.openapi_spec_url as string)?.trim();
      return {
        ...(def ? { api_definition: def.slice(0, 500_000) } : {}),
        ...(specUrl ? { openapi_spec_url: specUrl } : {}),
      };
    },
  };
}

export function getDatabaseSchema(t: Translations): SchemaFormConfig {
  const s = t.vault.schema_configs.database;
  return {
    headerIcon: (
      <div className="w-9 h-9 rounded-card bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center">
        <Database className="w-[1.125rem] h-[1.125rem] text-emerald-400" />
      </div>
    ),
    title: s.title,
    subtitle: s.subtitle,
    nameLabel: s.name_label,
    namePlaceholder: s.name_placeholder,
    subTypeLabel: s.subtype_label,
    subTypes: [
      {
        id: 'postgresql', label: s.subtype_postgresql_label, description: s.subtype_postgresql_description, color: '#336791',
        fields: [
          { key: 'host', label: s.field_host_label, type: 'text', required: true, placeholder: 'localhost', helpText: s.field_host_help },
          { key: 'port', label: s.field_port_label, type: 'text', required: false, placeholder: '5432', helpText: s.field_port_help },
          { key: 'database', label: s.field_database_label, type: 'text', required: true, placeholder: 'mydb' },
          { key: 'username', label: s.field_username_label, type: 'text', required: true, placeholder: 'postgres' },
          { key: 'password', label: s.field_password_label, type: 'password', required: true },
          { key: 'ssl_mode', label: s.field_ssl_mode_label, type: 'select', required: false, options: ['disable', 'prefer', 'require'], helpText: s.field_ssl_mode_help },
        ],
        noHealthcheckHint: s.subtype_postgresql_no_healthcheck,
      },
      {
        id: 'supabase', label: s.subtype_supabase_label, description: s.subtype_supabase_description, color: '#3ECF8E',
        fields: [
          { key: 'project_url', label: s.field_project_url_label, type: 'url', required: true, placeholder: 'https://xxxx.supabase.co', helpText: s.field_project_url_help },
          { key: 'anon_key', label: s.field_anon_key_label, type: 'password', required: true, placeholder: 'eyJ...', helpText: s.field_anon_key_help },
          { key: 'service_role_key', label: s.field_service_role_key_label, type: 'password', required: false, placeholder: 'eyJ...', helpText: s.field_service_role_key_help },
        ],
        healthcheck: (vals) => {
          const url = vals.project_url?.trim();
          if (!url) return null;
          return {
            endpoint: `${url.replace(/\/$/, '')}/rest/v1/`,
            method: 'GET',
            headers: { apikey: '{{anon_key}}', Authorization: 'Bearer {{anon_key}}' },
            description: s.subtype_supabase_endpoint_description,
          };
        },
        testHint: s.subtype_supabase_test_hint,
      },
      {
        id: 'convex', label: s.subtype_convex_label, description: s.subtype_convex_description, color: '#8B5CF6',
        fields: [
          { key: 'deployment_url', label: s.field_deployment_url_label, type: 'url', required: true, placeholder: 'https://your-app.convex.cloud', helpText: s.field_deployment_url_help },
          { key: 'deploy_key', label: s.field_deploy_key_label, type: 'password', required: true, placeholder: 'prod:...', helpText: s.field_deploy_key_help },
        ],
        healthcheck: (vals) => {
          const url = vals.deployment_url?.trim();
          if (!url) return null;
          return {
            endpoint: url.replace(/\/$/, ''),
            method: 'GET',
            headers: {},
            description: s.subtype_convex_endpoint_description,
          };
        },
        testHint: s.subtype_convex_test_hint,
      },
      {
        id: 'mongodb', label: s.subtype_mongodb_label, description: s.subtype_mongodb_description, color: '#00ED64',
        fields: [
          { key: 'connection_string', label: s.field_connection_string_label, type: 'password', required: true, placeholder: 'mongodb+srv://user:pass@cluster.mongodb.net', helpText: s.field_connection_string_help },
          { key: 'database_name', label: s.field_database_name_label, type: 'text', required: true, placeholder: 'mydb', helpText: s.field_database_name_help },
        ],
        noHealthcheckHint: s.subtype_mongodb_no_healthcheck,
      },
    ],
    subTypeLayout: 'grid',
    subTypeActiveClass: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
    serviceTypePrefix: 'db',
    category: 'database',
    connectorColor: '#3ECF8E',
    healthKey: 'database-connection',
    subTypeMetadataKey: 'database_type',
    extraFields: [
      {
        kind: 'textarea',
        key: 'schema_spec',
        sectionTitle: s.schema_spec_section,
        placeholder: s.schema_spec_placeholder,
        rows: 5,
      },
      {
        kind: 'checkbox',
        key: 'auto_explore_schema',
        label: s.auto_explore_label,
      },
    ],
    buildExtraMetadata: (_subTypeId, extras) => ({
      auto_explore_schema: extras.auto_explore_schema ?? false,
      ...((extras.schema_spec as string)?.trim() ? { schema_spec: (extras.schema_spec as string).trim() } : {}),
    }),
  };
}
