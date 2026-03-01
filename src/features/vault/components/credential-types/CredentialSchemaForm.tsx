import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Plus, Trash2, Server, Link, Database } from 'lucide-react';
import { CredentialEditForm } from '@/features/vault/components/CredentialEditForm';
import { useCredentialHealth } from '@/features/vault/hooks/useCredentialHealth';
import type { CredentialTemplateField } from '@/lib/types/types';
import { usePersonaStore } from '@/stores/personaStore';

// ── Types ─────────────────────────────────────────────────────────────

interface HealthcheckConfig {
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

// ── Helpers ────────────────────────────────────────────────────────────

function sanitize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

function buildEnvMap(extras: Record<string, unknown>): Record<string, string> {
  const pairs = (extras.env_vars as { key: string; value: string }[]) ?? [];
  const map: Record<string, string> = {};
  for (const ev of pairs) {
    if (ev.key.trim()) map[ev.key.trim()] = ev.value;
  }
  return map;
}

function buildCustomHealthcheck(
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
    case 'basic':
      headers['Authorization'] = 'Basic {{username}}:{{password}}';
      break;
    case 'custom-headers':
      if (values.header_1_name?.trim()) headers[values.header_1_name.trim()] = '{{header_1_value}}';
      if (values.header_2_name?.trim()) headers[values.header_2_name.trim()] = '{{header_2_value}}';
      break;
  }
  return { endpoint: baseUrl, method: 'GET', headers, description: 'Healthcheck for custom connection' };
}

// ── Component ─────────────────────────────────────────────────────────

interface CredentialSchemaFormProps {
  config: SchemaFormConfig;
  onBack: () => void;
  onComplete: () => void;
  /** Override the default sub-type (e.g. from an auth method). */
  defaultSubType?: string;
  /** Pre-fill credential field values. */
  initialValues?: Record<string, string>;
  /** Pre-fill extra field state (e.g. env vars from auth method). */
  initialExtras?: Record<string, unknown>;
  /** Skip name input; use this as the connector label. */
  nameOverride?: string;
  /** Skip deriving serviceType from name; use this directly. */
  serviceTypeOverride?: string;
  /** Hide the header (back button + icon + title). */
  showHeader?: boolean;
}

export function CredentialSchemaForm({
  config,
  onBack,
  onComplete,
  defaultSubType,
  initialValues,
  initialExtras,
  nameOverride,
  serviceTypeOverride,
  showHeader = true,
}: CredentialSchemaFormProps) {
  const [name, setName] = useState('');
  const [subTypeId, setSubTypeId] = useState(defaultSubType ?? config.subTypes[0]!.id);
  const [error, setError] = useState<string | null>(null);
  const [extraState, setExtraState] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {};
    for (const ef of config.extraFields ?? []) {
      switch (ef.kind) {
        case 'textarea': init[ef.key] = ''; break;
        case 'checkbox': init[ef.key] = false; break;
        case 'key-value-list': init[ef.key] = []; break;
      }
    }
    return { ...init, ...initialExtras };
  });

  const createCredential = usePersonaStore((s) => s.createCredential);
  const createConnectorDefinition = usePersonaStore((s) => s.createConnectorDefinition);
  const fetchCredentials = usePersonaStore((s) => s.fetchCredentials);
  const fetchConnectorDefinitions = usePersonaStore((s) => s.fetchConnectorDefinitions);
  const health = useCredentialHealth(config.healthKey);

  const activeSubType = (config.subTypes.find((st) => st.id === subTypeId) ?? config.subTypes[0])!;
  const hasHealthcheck = !!activeSubType.healthcheck;

  const handleSubTypeChange = useCallback((id: string) => {
    setSubTypeId(id);
    health.invalidate();
  }, [health.invalidate]);

  const handleHealthcheck = useCallback(async (fieldValues: Record<string, string>) => {
    if (!activeSubType.healthcheck) return;
    const hcConfig = activeSubType.healthcheck(fieldValues);
    if (!hcConfig) return;
    const serviceType = serviceTypeOverride
      ?? `${config.serviceTypePrefix}_${sanitize(nameOverride ?? (name.trim() || config.title))}`;
    await health.checkDesign(
      nameOverride ?? (name.trim() || config.title),
      { name: serviceType, healthcheck_config: hcConfig },
      fieldValues,
    );
  }, [activeSubType, config.serviceTypePrefix, config.title, name, nameOverride, serviceTypeOverride, health.checkDesign]);

  const handleSave = async (fieldValues: Record<string, string>) => {
    const effectiveName = nameOverride ?? name.trim();
    if (!nameOverride && !name.trim()) {
      setError(`${config.nameLabel} is required`);
      return;
    }
    setError(null);

    try {
      const serviceType = serviceTypeOverride ?? `${config.serviceTypePrefix}_${sanitize(effectiveName)}`;
      const connColor = activeSubType.color ?? config.connectorColor;

      const fields = activeSubType.fields.map((f) => ({
        key: f.key, label: f.label, type: f.type,
        required: f.required ?? false, placeholder: f.placeholder,
        helpText: f.helpText, options: f.options,
      }));

      const hcConfig = activeSubType.healthcheck?.(fieldValues) ?? null;

      const metadata: Record<string, unknown> = {
        [config.subTypeMetadataKey]: subTypeId,
        template_enabled: false,
        ...(config.buildExtraMetadata?.(subTypeId, extraState) ?? {}),
      };

      await createConnectorDefinition({
        name: serviceType,
        label: effectiveName,
        color: connColor,
        category: config.category,
        fields: JSON.stringify(fields),
        healthcheck_config: hcConfig ? JSON.stringify(hcConfig) : null,
        services: JSON.stringify([]),
        events: JSON.stringify([]),
        metadata: JSON.stringify(metadata),
        is_builtin: false,
      });

      const credData = config.buildExtraCredData
        ? { ...fieldValues, ...config.buildExtraCredData(subTypeId, extraState) }
        : fieldValues;

      await createCredential({
        name: `${effectiveName} Credential`,
        service_type: serviceType,
        data: credData,
      });

      await Promise.all([fetchCredentials(), fetchConnectorDefinitions()]);
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to save ${config.title.toLowerCase()}`);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-5"
    >
      {/* Header */}
      {showHeader && (
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground/80 hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          {config.headerIcon}
          <div>
            <h3 className="text-sm font-semibold text-foreground">{config.title}</h3>
            <p className="text-xs text-muted-foreground/60">{config.subtitle}</p>
          </div>
        </div>
      )}

      {/* Name input */}
      {!nameOverride && (
        <div>
          <label className="block text-sm font-medium text-foreground/80 mb-1.5">
            {config.nameLabel} <span className="text-red-400 ml-1">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={config.namePlaceholder}
            className="w-full px-3 py-2 bg-background/50 border border-border/50 rounded-xl text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all placeholder-muted-foreground/30"
          />
        </div>
      )}

      {/* Sub-type selector */}
      {config.subTypes.length > 1 && (
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground/50 mb-3">
            {config.subTypeLabel}
          </label>

          {config.subTypeLayout === 'flex' ? (
            <>
              <div className="flex gap-2">
                {config.subTypes.map((st) => (
                  <button
                    key={st.id}
                    onClick={() => handleSubTypeChange(st.id)}
                    className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-medium border transition-all ${
                      subTypeId === st.id
                        ? config.subTypeActiveClass
                        : 'bg-secondary/25 border-primary/15 text-muted-foreground/80 hover:bg-secondary/40'
                    }`}
                  >
                    {st.displayLabel ?? st.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground/60">{activeSubType.description}</p>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {config.subTypes.map((st) => (
                <button
                  key={st.id}
                  onClick={() => handleSubTypeChange(st.id)}
                  className={`text-left px-3 py-2.5 rounded-xl text-sm border transition-all ${
                    subTypeId === st.id
                      ? config.subTypeActiveClass
                      : 'bg-secondary/25 border-primary/15 text-muted-foreground/80 hover:bg-secondary/40'
                  }`}
                >
                  <div className="font-medium text-xs flex items-center gap-2">
                    {st.color && <div className="w-2 h-2 rounded-full" style={{ backgroundColor: st.color }} />}
                    {st.label}
                  </div>
                  <div className="text-xs text-muted-foreground/50 mt-0.5">{st.description}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Credential fields */}
      <div className="border-t border-primary/8" />
      <CredentialEditForm
        fields={activeSubType.fields}
        initialValues={initialValues}
        onSave={handleSave}
        onCancel={onBack}
        onHealthcheck={hasHealthcheck ? handleHealthcheck : undefined}
        isHealthchecking={health.isHealthchecking}
        healthcheckResult={health.result}
        testHint={activeSubType.testHint}
      />

      {!hasHealthcheck && activeSubType.noHealthcheckHint && (
        <p className="text-xs text-muted-foreground/50 italic">{activeSubType.noHealthcheckHint}</p>
      )}

      {/* Extra fields */}
      {config.extraFields?.map((ef) => (
        <ExtraFieldRenderer key={ef.key} def={ef} state={extraState} setState={setExtraState} />
      ))}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </motion.div>
  );
}

// ── Extra field renderers ─────────────────────────────────────────────

function ExtraFieldRenderer({
  def,
  state,
  setState,
}: {
  def: ExtraFieldDef;
  state: Record<string, unknown>;
  setState: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
}) {
  switch (def.kind) {
    case 'textarea':
      return (
        <>
          <div className="border-t border-primary/8" />
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/50 mb-3">
              {def.sectionTitle}
            </h4>
            <textarea
              value={(state[def.key] as string) ?? ''}
              onChange={(e) => setState((prev) => ({ ...prev, [def.key]: e.target.value }))}
              placeholder={def.placeholder}
              rows={def.rows ?? 4}
              className="w-full px-3 py-2 bg-background/50 border border-border/50 rounded-xl text-foreground text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all placeholder-muted-foreground/30 resize-y"
            />
            {def.helpText && <p className="mt-1 text-xs text-muted-foreground/60">{def.helpText}</p>}
          </div>
        </>
      );

    case 'checkbox':
      return (
        <label className="flex items-center gap-2 mt-2.5 cursor-pointer group">
          <input
            type="checkbox"
            checked={(state[def.key] as boolean) ?? false}
            onChange={(e) => setState((prev) => ({ ...prev, [def.key]: e.target.checked }))}
            className="w-3.5 h-3.5 rounded border-border/50 bg-background/50 text-primary focus:ring-primary/40"
          />
          <span className="text-xs text-muted-foreground/70 group-hover:text-muted-foreground/90 transition-colors">
            {def.label}
          </span>
        </label>
      );

    case 'key-value-list':
      return <KeyValueListField def={def} state={state} setState={setState} />;
  }
}

function KeyValueListField({
  def,
  state,
  setState,
}: {
  def: Extract<ExtraFieldDef, { kind: 'key-value-list' }>;
  state: Record<string, unknown>;
  setState: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
}) {
  const pairs = (state[def.key] as { key: string; value: string }[]) ?? [];

  const update = useCallback(
    (next: { key: string; value: string }[]) => setState((prev) => ({ ...prev, [def.key]: next })),
    [def.key, setState],
  );

  return (
    <>
      <div className="border-t border-primary/8" />
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/50">
            {def.sectionTitle}
          </h4>
          <button
            onClick={() => update([...pairs, { key: '', value: '' }])}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border transition-colors ${
              def.addButtonClass ?? 'text-primary hover:text-primary/80 bg-primary/10 hover:bg-primary/15 border-primary/20'
            }`}
          >
            <Plus className="w-3 h-3" />
            {def.addLabel ?? 'Add'}
          </button>
        </div>

        {pairs.length === 0 && (
          <p className="text-xs text-muted-foreground/40 italic">{def.emptyMessage ?? 'None configured.'}</p>
        )}

        <div className="space-y-2">
          {pairs.map((pair, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={pair.key}
                onChange={(e) => {
                  const next = [...pairs];
                  next[i] = { ...pair, key: e.target.value };
                  update(next);
                }}
                placeholder="KEY"
                className="flex-1 px-2.5 py-1.5 bg-background/50 border border-border/50 rounded-lg text-xs text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder-muted-foreground/30"
              />
              <span className="text-muted-foreground/30">=</span>
              <input
                type="text"
                value={pair.value}
                onChange={(e) => {
                  const next = [...pairs];
                  next[i] = { ...pair, value: e.target.value };
                  update(next);
                }}
                placeholder="value"
                className="flex-1 px-2.5 py-1.5 bg-background/50 border border-border/50 rounded-lg text-xs text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder-muted-foreground/30"
              />
              <button
                onClick={() => update(pairs.filter((_, j) => j !== i))}
                className="p-1 text-muted-foreground/40 hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ── MCP Server Config ─────────────────────────────────────────────────

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

// ── Custom Connection Config ──────────────────────────────────────────

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

// ── Database Connection Config ────────────────────────────────────────

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
