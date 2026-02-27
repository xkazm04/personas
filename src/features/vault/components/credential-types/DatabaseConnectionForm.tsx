import { useState } from 'react';
import { motion } from 'framer-motion';
import { Database, ArrowLeft } from 'lucide-react';
import { CredentialEditForm } from '@/features/vault/components/CredentialEditForm';
import type { CredentialTemplateField } from '@/lib/types/types';
import { usePersonaStore } from '@/stores/personaStore';
import { useHealthcheckState } from '@/features/vault/hooks/useHealthcheckState';

interface DatabaseConnectionFormProps {
  onBack: () => void;
  onComplete: () => void;
}

type DatabaseType = 'postgresql' | 'supabase' | 'convex' | 'mongodb';

const DB_OPTIONS: { id: DatabaseType; label: string; color: string; description: string }[] = [
  { id: 'postgresql', label: 'PostgreSQL', color: '#336791', description: 'Direct PostgreSQL connection' },
  { id: 'supabase', label: 'Supabase', color: '#3ECF8E', description: 'Supabase project via REST API' },
  { id: 'convex', label: 'Convex', color: '#8B5CF6', description: 'Convex deployment with deploy key' },
  { id: 'mongodb', label: 'MongoDB', color: '#00ED64', description: 'MongoDB connection string' },
];

const DB_FIELDS: Record<DatabaseType, CredentialTemplateField[]> = {
  postgresql: [
    { key: 'host', label: 'Host', type: 'text', required: true, placeholder: 'localhost', helpText: 'Database server hostname or IP' },
    { key: 'port', label: 'Port', type: 'text', required: false, placeholder: '5432', helpText: 'Default: 5432' },
    { key: 'database', label: 'Database', type: 'text', required: true, placeholder: 'mydb' },
    { key: 'username', label: 'Username', type: 'text', required: true, placeholder: 'postgres' },
    { key: 'password', label: 'Password', type: 'password', required: true },
    { key: 'ssl_mode', label: 'SSL Mode', type: 'select', required: false, options: ['disable', 'prefer', 'require'], helpText: 'Connection SSL mode' },
  ],
  supabase: [
    { key: 'project_url', label: 'Project URL', type: 'url', required: true, placeholder: 'https://xxxx.supabase.co', helpText: 'Your Supabase project URL' },
    { key: 'anon_key', label: 'Anon Key', type: 'password', required: true, placeholder: 'eyJ...', helpText: 'Public anon key from project settings' },
    { key: 'service_role_key', label: 'Service Role Key', type: 'password', required: false, placeholder: 'eyJ...', helpText: 'Optional: service role key for admin operations' },
  ],
  convex: [
    { key: 'deployment_url', label: 'Deployment URL', type: 'url', required: true, placeholder: 'https://your-app.convex.cloud', helpText: 'Your Convex deployment URL' },
    { key: 'deploy_key', label: 'Deploy Key', type: 'password', required: true, placeholder: 'prod:...', helpText: 'Deploy key from Convex dashboard' },
  ],
  mongodb: [
    { key: 'connection_string', label: 'Connection String', type: 'password', required: true, placeholder: 'mongodb+srv://user:pass@cluster.mongodb.net', helpText: 'Full MongoDB connection URI' },
    { key: 'database_name', label: 'Database Name', type: 'text', required: true, placeholder: 'mydb', helpText: 'Default database to connect to' },
  ],
};

const HEALTHCHECK_CONFIGS: Record<DatabaseType, (vals: Record<string, string>) => { endpoint: string; method: string; headers: Record<string, string>; description: string } | null> = {
  supabase: (vals) => {
    const url = vals.project_url?.trim();
    if (!url) return null;
    return {
      endpoint: `${url.replace(/\/$/, '')}/rest/v1/`,
      method: 'GET',
      headers: {
        apikey: '{{anon_key}}',
        Authorization: 'Bearer {{anon_key}}',
      },
      description: 'Validates Supabase connection via REST API',
    };
  },
  convex: (vals) => {
    const url = vals.deployment_url?.trim();
    if (!url) return null;
    return {
      endpoint: url.replace(/\/$/, ''),
      method: 'GET',
      headers: {},
      description: 'Validates Convex deployment URL is reachable',
    };
  },
  postgresql: () => null,
  mongodb: () => null,
};

export function DatabaseConnectionForm({ onBack, onComplete }: DatabaseConnectionFormProps) {
  const [connectionName, setConnectionName] = useState('');
  const [dbType, setDbType] = useState<DatabaseType>('supabase');
  const [schemaSpec, setSchemaSpec] = useState('');
  const [autoExplore, setAutoExplore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createCredential = usePersonaStore((s) => s.createCredential);
  const createConnectorDefinition = usePersonaStore((s) => s.createConnectorDefinition);
  const fetchCredentials = usePersonaStore((s) => s.fetchCredentials);
  const fetchConnectorDefinitions = usePersonaStore((s) => s.fetchConnectorDefinitions);
  const healthcheck = useHealthcheckState();

  const canHealthcheck = dbType === 'supabase' || dbType === 'convex';

  const handleHealthcheck = async (fieldValues: Record<string, string>) => {
    const configBuilder = HEALTHCHECK_CONFIGS[dbType];
    const config = configBuilder(fieldValues);
    if (!config) return;

    const serviceType = `db_${(connectionName.trim() || dbType).toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
    await healthcheck.runHealthcheck(
      connectionName.trim() || DB_OPTIONS.find((o) => o.id === dbType)!.label,
      { name: serviceType, healthcheck_config: config },
      fieldValues,
    );
  };

  const handleSave = async (fieldValues: Record<string, string>) => {
    const name = connectionName.trim();
    if (!name) {
      setError('Connection name is required');
      return;
    }

    setError(null);

    try {
      const serviceType = `db_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
      const dbOption = DB_OPTIONS.find((o) => o.id === dbType)!;

      const fields = DB_FIELDS[dbType].map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        required: f.required ?? false,
        placeholder: f.placeholder,
        helpText: f.helpText,
        options: f.options,
      }));

      const configBuilder = HEALTHCHECK_CONFIGS[dbType];
      const hcConfig = configBuilder(fieldValues);

      const metadata: Record<string, unknown> = {
        database_type: dbType,
        template_enabled: false,
        auto_explore_schema: autoExplore,
      };
      if (schemaSpec.trim()) {
        metadata.schema_spec = schemaSpec.trim();
      }

      await createConnectorDefinition({
        name: serviceType,
        label: name,
        color: dbOption.color,
        category: 'database',
        fields: JSON.stringify(fields),
        healthcheck_config: hcConfig ? JSON.stringify(hcConfig) : null,
        services: JSON.stringify([]),
        events: JSON.stringify([]),
        metadata: JSON.stringify(metadata),
      });

      await createCredential({
        name: `${name} Credential`,
        service_type: serviceType,
        data: fieldValues,
      });

      await Promise.all([fetchCredentials(), fetchConnectorDefinitions()]);
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save database connection');
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
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground/80 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center">
          <Database className="w-4.5 h-4.5 text-emerald-400" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Database Connection</h3>
          <p className="text-xs text-muted-foreground/60">Connect to a database with optional schema specification</p>
        </div>
      </div>

      {/* Connection Name */}
      <div>
        <label className="block text-sm font-medium text-foreground/80 mb-1.5">
          Connection Name <span className="text-red-400 ml-1">*</span>
        </label>
        <input
          type="text"
          value={connectionName}
          onChange={(e) => setConnectionName(e.target.value)}
          placeholder="My Database"
          className="w-full px-3 py-2 bg-background/50 border border-border/50 rounded-xl text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all placeholder-muted-foreground/30"
        />
      </div>

      {/* Database Type */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground/50 mb-3">
          Database Type
        </label>
        <div className="grid grid-cols-2 gap-2">
          {DB_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => { setDbType(opt.id); healthcheck.reset(); }}
              className={`text-left px-3 py-2.5 rounded-xl text-sm border transition-all ${
                dbType === opt.id
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                  : 'bg-secondary/25 border-primary/15 text-muted-foreground/80 hover:bg-secondary/40'
              }`}
            >
              <div className="font-medium text-xs flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: opt.color }} />
                {opt.label}
              </div>
              <div className="text-xs text-muted-foreground/50 mt-0.5">{opt.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Credential Fields */}
      <div className="border-t border-primary/8" />
      <CredentialEditForm
        fields={DB_FIELDS[dbType]}
        onSave={handleSave}
        onCancel={onBack}
        onHealthcheck={canHealthcheck ? handleHealthcheck : undefined}
        isHealthchecking={healthcheck.isHealthchecking}
        healthcheckResult={healthcheck.healthcheckResult}
        testHint={
          !canHealthcheck
            ? undefined
            : dbType === 'supabase'
              ? 'Tests connection via Supabase REST API with your anon key.'
              : 'Tests reachability of your Convex deployment URL.'
        }
      />

      {!canHealthcheck && (
        <p className="text-xs text-muted-foreground/50 italic">
          Direct database healthcheck is not yet supported for {DB_OPTIONS.find((o) => o.id === dbType)?.label}. Save credentials and verify manually.
        </p>
      )}

      {/* Schema Specification */}
      <div className="border-t border-primary/8" />
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/50 mb-3">
          Data Schema (Optional)
        </h4>
        <textarea
          value={schemaSpec}
          onChange={(e) => setSchemaSpec(e.target.value)}
          placeholder={"Describe your database schema, paste SQL CREATE statements, or write table documentation...\n\nExample:\n- users: id, email, name, created_at\n- orders: id, user_id (FK), total, status (pending|paid|shipped)"}
          rows={5}
          className="w-full px-3 py-2 bg-background/50 border border-border/50 rounded-xl text-foreground text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all placeholder-muted-foreground/30 resize-y"
        />

        <label className="flex items-center gap-2 mt-2.5 cursor-pointer group">
          <input
            type="checkbox"
            checked={autoExplore}
            onChange={(e) => setAutoExplore(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-border/50 bg-background/50 text-primary focus:ring-primary/40"
          />
          <span className="text-xs text-muted-foreground/70 group-hover:text-muted-foreground/90 transition-colors">
            Auto-explore schema on first use (let AI discover tables and relationships)
          </span>
        </label>
      </div>

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}
    </motion.div>
  );
}
