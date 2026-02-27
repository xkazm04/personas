import { useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Plus, Trash2 } from 'lucide-react';
import { CredentialEditForm } from '@/features/vault/components/CredentialEditForm';
import type { ConnectorDefinition, ConnectorAuthMethod, CredentialTemplateField } from '@/lib/types/types';
import { usePersonaStore } from '@/stores/personaStore';

interface McpPrefilledFormProps {
  connector: ConnectorDefinition;
  authMethod: ConnectorAuthMethod;
  onComplete: () => void;
  onCancel: () => void;
}

type ConnectionType = 'stdio' | 'sse';

const BASE_FIELDS: Record<ConnectionType, CredentialTemplateField[]> = {
  stdio: [
    { key: 'command', label: 'Command', type: 'text', required: true, placeholder: 'npx -y @modelcontextprotocol/server-filesystem', helpText: 'The shell command to start the MCP server process' },
    { key: 'working_directory', label: 'Working Directory', type: 'text', required: false, placeholder: '/home/user/project', helpText: 'Optional: directory to run the command from' },
  ],
  sse: [
    { key: 'url', label: 'Server URL', type: 'url', required: true, placeholder: 'https://mcp.example.com/sse', helpText: 'The SSE endpoint URL for the MCP server' },
    { key: 'auth_token', label: 'Auth Token', type: 'password', required: false, placeholder: 'Bearer token or API key', helpText: 'Optional: authentication token sent with requests' },
  ],
};

export function McpPrefilledForm({ connector, authMethod, onComplete, onCancel }: McpPrefilledFormProps) {
  const [connectionType, setConnectionType] = useState<ConnectionType>(
    (authMethod.transport as ConnectionType) ?? 'stdio'
  );
  const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const createCredential = usePersonaStore((s) => s.createCredential);
  const createConnectorDefinition = usePersonaStore((s) => s.createConnectorDefinition);
  const fetchCredentials = usePersonaStore((s) => s.fetchCredentials);
  const fetchConnectorDefinitions = usePersonaStore((s) => s.fetchConnectorDefinitions);

  // Pre-populate environment variables from authMethod.suggested_env
  useEffect(() => {
    if (authMethod.suggested_env && Object.keys(authMethod.suggested_env).length > 0) {
      setEnvVars(
        Object.entries(authMethod.suggested_env).map(([key, value]) => ({ key, value }))
      );
    }
  }, [authMethod.suggested_env]);

  const addEnvVar = useCallback(() => {
    setEnvVars((prev) => [...prev, { key: '', value: '' }]);
  }, []);

  const removeEnvVar = useCallback((index: number) => {
    setEnvVars((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateEnvVar = useCallback((index: number, field: 'key' | 'value', val: string) => {
    setEnvVars((prev) => prev.map((ev, i) => (i === index ? { ...ev, [field]: val } : ev)));
  }, []);

  // Build initial values for the connection fields
  const initialValues: Record<string, string> = {};
  if (connectionType === 'stdio' && authMethod.package) {
    initialValues.command = `npx -y ${authMethod.package}`;
  }

  const handleSave = async (fieldValues: Record<string, string>) => {
    setError(null);

    try {
      const envMap: Record<string, string> = {};
      for (const ev of envVars) {
        if (ev.key.trim()) envMap[ev.key.trim()] = ev.value;
      }

      const serviceType = `mcp_${connector.name}`;

      // Create connector definition
      const fields = BASE_FIELDS[connectionType].map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        required: f.required ?? false,
        placeholder: f.placeholder,
        helpText: f.helpText,
      }));

      await createConnectorDefinition({
        name: serviceType,
        label: `${connector.label} MCP`,
        color: '#06B6D4',
        category: 'mcp',
        fields: JSON.stringify(fields),
        healthcheck_config: null,
        services: JSON.stringify([]),
        events: JSON.stringify([]),
        metadata: JSON.stringify({
          connection_type: connectionType,
          env_vars: envMap,
          template_enabled: false,
        }),
      });

      // Save credential with all connection data
      const credData: Record<string, string> = {
        ...fieldValues,
        connection_type: connectionType,
      };
      if (Object.keys(envMap).length > 0) {
        credData.env_vars = JSON.stringify(envMap);
      }

      await createCredential({
        name: `${connector.label} MCP Credential`,
        service_type: serviceType,
        data: credData,
      });

      await Promise.all([fetchCredentials(), fetchConnectorDefinitions()]);
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save MCP server');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-5"
    >
      {/* Connection Type */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground/50 mb-3">
          Connection Type
        </label>
        <div className="flex gap-2">
          {(['stdio', 'sse'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setConnectionType(type)}
              className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-medium border transition-all ${
                connectionType === type
                  ? 'bg-cyan-500/15 border-cyan-500/30 text-cyan-300'
                  : 'bg-secondary/25 border-primary/15 text-muted-foreground/80 hover:bg-secondary/40'
              }`}
            >
              {type === 'stdio' ? 'stdio (Command)' : 'SSE (HTTP)'}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground/60">
          {connectionType === 'stdio'
            ? 'Spawn a local process that communicates over stdin/stdout.'
            : 'Connect to a remote server via Server-Sent Events.'}
        </p>
      </div>

      {/* Connection Fields */}
      <div className="border-t border-primary/8" />
      <CredentialEditForm
        fields={BASE_FIELDS[connectionType]}
        initialValues={initialValues}
        onSave={handleSave}
        onCancel={onCancel}
      />

      {/* Environment Variables */}
      <div className="border-t border-primary/8" />
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/50">
            Environment Variables
          </h4>
          <button
            onClick={addEnvVar}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/15 border border-cyan-500/20 rounded-lg transition-colors"
          >
            <Plus className="w-3 h-3" />
            Add
          </button>
        </div>

        {envVars.length === 0 && (
          <p className="text-xs text-muted-foreground/40 italic">No environment variables configured.</p>
        )}

        <div className="space-y-2">
          {envVars.map((ev, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={ev.key}
                onChange={(e) => updateEnvVar(i, 'key', e.target.value)}
                placeholder="KEY"
                className="flex-1 px-2.5 py-1.5 bg-background/50 border border-border/50 rounded-lg text-xs text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder-muted-foreground/30"
              />
              <span className="text-muted-foreground/30">=</span>
              <input
                type="text"
                value={ev.value}
                onChange={(e) => updateEnvVar(i, 'value', e.target.value)}
                placeholder="value"
                className="flex-1 px-2.5 py-1.5 bg-background/50 border border-border/50 rounded-lg text-xs text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder-muted-foreground/30"
              />
              <button
                onClick={() => removeEnvVar(i)}
                className="p-1 text-muted-foreground/40 hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}
    </motion.div>
  );
}
