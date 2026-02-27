import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Server, ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { CredentialEditForm } from '@/features/vault/components/CredentialEditForm';
import type { CredentialTemplateField } from '@/lib/types/types';
import { usePersonaStore } from '@/stores/personaStore';

interface McpServerFormProps {
  onBack: () => void;
  onComplete: () => void;
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

export function McpServerForm({ onBack, onComplete }: McpServerFormProps) {
  const [serverName, setServerName] = useState('');
  const [connectionType, setConnectionType] = useState<ConnectionType>('stdio');
  const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const createCredential = usePersonaStore((s) => s.createCredential);
  const createConnectorDefinition = usePersonaStore((s) => s.createConnectorDefinition);
  const fetchCredentials = usePersonaStore((s) => s.fetchCredentials);
  const fetchConnectorDefinitions = usePersonaStore((s) => s.fetchConnectorDefinitions);

  const addEnvVar = useCallback(() => {
    setEnvVars((prev) => [...prev, { key: '', value: '' }]);
  }, []);

  const removeEnvVar = useCallback((index: number) => {
    setEnvVars((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateEnvVar = useCallback((index: number, field: 'key' | 'value', val: string) => {
    setEnvVars((prev) => prev.map((ev, i) => (i === index ? { ...ev, [field]: val } : ev)));
  }, []);

  const handleSave = async (fieldValues: Record<string, string>) => {
    const name = serverName.trim();
    if (!name) {
      setError('Server name is required');
      return;
    }

    setError(null);

    try {
      const envMap: Record<string, string> = {};
      for (const ev of envVars) {
        if (ev.key.trim()) envMap[ev.key.trim()] = ev.value;
      }

      const serviceType = `mcp_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;

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
        label: name,
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
        name: `${name} Credential`,
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
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground/80 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/25 flex items-center justify-center">
          <Server className="w-4.5 h-4.5 text-cyan-400" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">MCP Server</h3>
          <p className="text-xs text-muted-foreground/60">Connect to a Model Context Protocol server</p>
        </div>
      </div>

      {/* Server Name */}
      <div>
        <label className="block text-sm font-medium text-foreground/80 mb-1.5">
          Server Name <span className="text-red-400 ml-1">*</span>
        </label>
        <input
          type="text"
          value={serverName}
          onChange={(e) => setServerName(e.target.value)}
          placeholder="My MCP Server"
          className="w-full px-3 py-2 bg-background/50 border border-border/50 rounded-xl text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all placeholder-muted-foreground/30"
        />
      </div>

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
        onSave={handleSave}
        onCancel={onBack}
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
