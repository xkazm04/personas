import { Server, Link, Database } from 'lucide-react';
import type { SchemaFormConfig } from './schemaFormTypes';
import { buildEnvMap, buildCustomHealthcheck } from './schemaFormTypes';

export const MCP_SCHEMA: SchemaFormConfig = {
  headerIcon: (
    <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/25 flex items-center justify-center">
      <Server className="w-4.5 h-4.5 text-cyan-400" />
    </div>
  ),
  title: 'MCP Server',
  subtitle: 'Connect to a Model Context Protocol server',
  nameLabel: 'Server Name',
  namePlaceholder: 'My MCP Server',
  subTypeLabel: 'Connection Type',
  subTypes: [
    {
      id: 'stdio',
      displayLabel: 'stdio (Command)',
      label: 'stdio',
      description: 'Spawn a local process that communicates over stdin/stdout.',
      fields: [
        { key: 'command', label: 'Command', type: 'text', required: true, placeholder: 'npx -y @modelcontextprotocol/server-filesystem', helpText: 'The shell command to start the MCP server process' },
        { key: 'working_directory', label: 'Working Directory', type: 'text', required: false, placeholder: '/home/user/project', helpText: 'Optional: directory to run the command from' },
      ],
    },
    {
      id: 'sse',
      displayLabel: 'SSE (HTTP)',
      label: 'sse',
      description: 'Connect to a remote server via Server-Sent Events.',
      fields: [
        { key: 'url', label: 'Server URL', type: 'url', required: true, placeholder: 'https://mcp.example.com/sse', helpText: 'The SSE endpoint URL for the MCP server' },
        { key: 'auth_token', label: 'Auth Token', type: 'password', required: false, placeholder: 'Bearer token or API key', helpText: 'Optional: authentication token sent with requests' },
      ],
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
      sectionTitle: 'Environment Variables',
      addLabel: 'Add',
      emptyMessage: 'No environment variables configured.',
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
};

export const CUSTOM_SCHEMA: SchemaFormConfig = {
  headerIcon: (
    <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/25 flex items-center justify-center">
      <Link className="w-4.5 h-4.5 text-amber-400" />
    </div>
  ),
  title: 'Custom Connection',
  subtitle: 'URL + authentication with optional API definition',
  nameLabel: 'Connection Name',
  namePlaceholder: 'My API Service',
  subTypeLabel: 'Authentication Method',
  subTypes: [
    {
      id: 'api-key', label: 'URL + API Key', description: 'Base URL with an API key header',
      fields: [
        { key: 'base_url', label: 'Base URL', type: 'url', required: true, placeholder: 'https://api.example.com', helpText: 'The root URL for all API requests' },
        { key: 'api_key', label: 'API Key', type: 'password', required: true, placeholder: 'sk-...', helpText: 'Your API key or secret token' },
        { key: 'header_name', label: 'Header Name', type: 'text', required: false, placeholder: 'X-API-Key', helpText: 'Header to send the key in (default: X-API-Key)' },
      ],
      healthcheck: (values) => buildCustomHealthcheck('api-key', values),
    },
    {
      id: 'bearer', label: 'URL + Bearer Token', description: 'Base URL with a Bearer authorization token',
      fields: [
        { key: 'base_url', label: 'Base URL', type: 'url', required: true, placeholder: 'https://api.example.com', helpText: 'The root URL for all API requests' },
        { key: 'bearer_token', label: 'Bearer Token', type: 'password', required: true, placeholder: 'eyJ...', helpText: 'Sent as Authorization: Bearer <token>' },
      ],
      healthcheck: (values) => buildCustomHealthcheck('bearer', values),
    },
    {
      id: 'basic', label: 'URL + Basic Auth', description: 'Base URL with username and password',
      fields: [
        { key: 'base_url', label: 'Base URL', type: 'url', required: true, placeholder: 'https://api.example.com', helpText: 'The root URL for all API requests' },
        { key: 'username', label: 'Username', type: 'text', required: true, placeholder: 'user@example.com' },
        { key: 'password', label: 'Password', type: 'password', required: true, placeholder: 'password' },
      ],
      healthcheck: (values) => buildCustomHealthcheck('basic', values),
    },
    {
      id: 'custom-headers', label: 'Custom Headers', description: 'Base URL with custom header key-value pairs',
      fields: [
        { key: 'base_url', label: 'Base URL', type: 'url', required: true, placeholder: 'https://api.example.com', helpText: 'The root URL for all API requests' },
        { key: 'header_1_name', label: 'Header 1 Name', type: 'text', required: true, placeholder: 'X-Custom-Key' },
        { key: 'header_1_value', label: 'Header 1 Value', type: 'password', required: true, placeholder: 'value' },
        { key: 'header_2_name', label: 'Header 2 Name', type: 'text', required: false, placeholder: 'X-Custom-Secret' },
        { key: 'header_2_value', label: 'Header 2 Value', type: 'password', required: false, placeholder: 'value' },
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
      key: 'api_definition',
      sectionTitle: 'API Definition (Optional)',
      placeholder: 'Paste OpenAPI/Swagger JSON or YAML here, or describe the API endpoints in plain text...',
      helpText: 'Helps AI understand available endpoints. Max 500KB.',
      rows: 4,
    },
  ],
  buildExtraMetadata: (_subTypeId, extras) => {
    const def = (extras.api_definition as string)?.trim();
    return def ? { api_definition: def.slice(0, 500_000) } : {};
  },
};

export const DATABASE_SCHEMA: SchemaFormConfig = {
  headerIcon: (
    <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center">
      <Database className="w-4.5 h-4.5 text-emerald-400" />
    </div>
  ),
  title: 'Database Connection',
  subtitle: 'Connect to a database with optional schema specification',
  nameLabel: 'Connection Name',
  namePlaceholder: 'My Database',
  subTypeLabel: 'Database Type',
  subTypes: [
    {
      id: 'postgresql', label: 'PostgreSQL', description: 'Direct PostgreSQL connection', color: '#336791',
      fields: [
        { key: 'host', label: 'Host', type: 'text', required: true, placeholder: 'localhost', helpText: 'Database server hostname or IP' },
        { key: 'port', label: 'Port', type: 'text', required: false, placeholder: '5432', helpText: 'Default: 5432' },
        { key: 'database', label: 'Database', type: 'text', required: true, placeholder: 'mydb' },
        { key: 'username', label: 'Username', type: 'text', required: true, placeholder: 'postgres' },
        { key: 'password', label: 'Password', type: 'password', required: true },
        { key: 'ssl_mode', label: 'SSL Mode', type: 'select', required: false, options: ['disable', 'prefer', 'require'], helpText: 'Connection SSL mode' },
      ],
      noHealthcheckHint: 'Direct database healthcheck is not yet supported for PostgreSQL. Save credentials and verify manually.',
    },
    {
      id: 'supabase', label: 'Supabase', description: 'Supabase project via REST API', color: '#3ECF8E',
      fields: [
        { key: 'project_url', label: 'Project URL', type: 'url', required: true, placeholder: 'https://xxxx.supabase.co', helpText: 'Your Supabase project URL' },
        { key: 'anon_key', label: 'Anon Key', type: 'password', required: true, placeholder: 'eyJ...', helpText: 'Public anon key from project settings' },
        { key: 'service_role_key', label: 'Service Role Key', type: 'password', required: false, placeholder: 'eyJ...', helpText: 'Optional: service role key for admin operations' },
      ],
      healthcheck: (vals) => {
        const url = vals.project_url?.trim();
        if (!url) return null;
        return {
          endpoint: `${url.replace(/\/$/, '')}/rest/v1/`,
          method: 'GET',
          headers: { apikey: '{{anon_key}}', Authorization: 'Bearer {{anon_key}}' },
          description: 'Validates Supabase connection via REST API',
        };
      },
      testHint: 'Tests connection via Supabase REST API with your anon key.',
    },
    {
      id: 'convex', label: 'Convex', description: 'Convex deployment with deploy key', color: '#8B5CF6',
      fields: [
        { key: 'deployment_url', label: 'Deployment URL', type: 'url', required: true, placeholder: 'https://your-app.convex.cloud', helpText: 'Your Convex deployment URL' },
        { key: 'deploy_key', label: 'Deploy Key', type: 'password', required: true, placeholder: 'prod:...', helpText: 'Deploy key from Convex dashboard' },
      ],
      healthcheck: (vals) => {
        const url = vals.deployment_url?.trim();
        if (!url) return null;
        return {
          endpoint: url.replace(/\/$/, ''),
          method: 'GET',
          headers: {},
          description: 'Validates Convex deployment URL is reachable',
        };
      },
      testHint: 'Tests reachability of your Convex deployment URL.',
    },
    {
      id: 'mongodb', label: 'MongoDB', description: 'MongoDB connection string', color: '#00ED64',
      fields: [
        { key: 'connection_string', label: 'Connection String', type: 'password', required: true, placeholder: 'mongodb+srv://user:pass@cluster.mongodb.net', helpText: 'Full MongoDB connection URI' },
        { key: 'database_name', label: 'Database Name', type: 'text', required: true, placeholder: 'mydb', helpText: 'Default database to connect to' },
      ],
      noHealthcheckHint: 'Direct database healthcheck is not yet supported for MongoDB. Save credentials and verify manually.',
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
      sectionTitle: 'Data Schema (Optional)',
      placeholder: "Describe your database schema, paste SQL CREATE statements, or write table documentation...\n\nExample:\n- users: id, email, name, created_at\n- orders: id, user_id (FK), total, status (pending|paid|shipped)",
      rows: 5,
    },
    {
      kind: 'checkbox',
      key: 'auto_explore_schema',
      label: 'Auto-explore schema on first use (let AI discover tables and relationships)',
    },
  ],
  buildExtraMetadata: (_subTypeId, extras) => ({
    auto_explore_schema: extras.auto_explore_schema ?? false,
    ...((extras.schema_spec as string)?.trim() ? { schema_spec: (extras.schema_spec as string).trim() } : {}),
  }),
};
