import { useState } from 'react';
import { motion } from 'framer-motion';
import { Link, ArrowLeft } from 'lucide-react';
import { CredentialEditForm } from '@/features/vault/components/CredentialEditForm';
import type { CredentialTemplateField } from '@/lib/types/types';
import { usePersonaStore } from '@/stores/personaStore';
import { useHealthcheckState } from '@/features/vault/hooks/useHealthcheckState';

interface CustomConnectionFormProps {
  onBack: () => void;
  onComplete: () => void;
}

type AuthTemplate = 'api-key' | 'bearer' | 'basic' | 'custom-headers';

const AUTH_TEMPLATES: { id: AuthTemplate; label: string; description: string }[] = [
  { id: 'api-key', label: 'URL + API Key', description: 'Base URL with an API key header' },
  { id: 'bearer', label: 'URL + Bearer Token', description: 'Base URL with a Bearer authorization token' },
  { id: 'basic', label: 'URL + Basic Auth', description: 'Base URL with username and password' },
  { id: 'custom-headers', label: 'Custom Headers', description: 'Base URL with custom header key-value pairs' },
];

const TEMPLATE_FIELDS: Record<AuthTemplate, CredentialTemplateField[]> = {
  'api-key': [
    { key: 'base_url', label: 'Base URL', type: 'url', required: true, placeholder: 'https://api.example.com', helpText: 'The root URL for all API requests' },
    { key: 'api_key', label: 'API Key', type: 'password', required: true, placeholder: 'sk-...', helpText: 'Your API key or secret token' },
    { key: 'header_name', label: 'Header Name', type: 'text', required: false, placeholder: 'X-API-Key', helpText: 'Header to send the key in (default: X-API-Key)' },
  ],
  bearer: [
    { key: 'base_url', label: 'Base URL', type: 'url', required: true, placeholder: 'https://api.example.com', helpText: 'The root URL for all API requests' },
    { key: 'bearer_token', label: 'Bearer Token', type: 'password', required: true, placeholder: 'eyJ...', helpText: 'Sent as Authorization: Bearer <token>' },
  ],
  basic: [
    { key: 'base_url', label: 'Base URL', type: 'url', required: true, placeholder: 'https://api.example.com', helpText: 'The root URL for all API requests' },
    { key: 'username', label: 'Username', type: 'text', required: true, placeholder: 'user@example.com' },
    { key: 'password', label: 'Password', type: 'password', required: true, placeholder: 'password' },
  ],
  'custom-headers': [
    { key: 'base_url', label: 'Base URL', type: 'url', required: true, placeholder: 'https://api.example.com', helpText: 'The root URL for all API requests' },
    { key: 'header_1_name', label: 'Header 1 Name', type: 'text', required: true, placeholder: 'X-Custom-Key' },
    { key: 'header_1_value', label: 'Header 1 Value', type: 'password', required: true, placeholder: 'value' },
    { key: 'header_2_name', label: 'Header 2 Name', type: 'text', required: false, placeholder: 'X-Custom-Secret' },
    { key: 'header_2_value', label: 'Header 2 Value', type: 'password', required: false, placeholder: 'value' },
  ],
};

export function CustomConnectionForm({ onBack, onComplete }: CustomConnectionFormProps) {
  const [connectionName, setConnectionName] = useState('');
  const [authTemplate, setAuthTemplate] = useState<AuthTemplate>('api-key');
  const [apiDefinition, setApiDefinition] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createCredential = usePersonaStore((s) => s.createCredential);
  const createConnectorDefinition = usePersonaStore((s) => s.createConnectorDefinition);
  const fetchCredentials = usePersonaStore((s) => s.fetchCredentials);
  const fetchConnectorDefinitions = usePersonaStore((s) => s.fetchConnectorDefinitions);
  const healthcheck = useHealthcheckState();

  const handleHealthcheck = async (fieldValues: Record<string, string>) => {
    const baseUrl = fieldValues.base_url?.trim();
    if (!baseUrl) return;

    const serviceType = `custom_${connectionName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'connection'}`;
    await healthcheck.runHealthcheck(
      connectionName.trim() || 'Custom Connection',
      { name: serviceType, healthcheck_config: buildHealthcheckConfig(authTemplate, fieldValues) },
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
      const serviceType = `custom_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;

      const fields = TEMPLATE_FIELDS[authTemplate].map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        required: f.required ?? false,
        placeholder: f.placeholder,
        helpText: f.helpText,
      }));

      const metadata: Record<string, unknown> = {
        auth_template: authTemplate,
        template_enabled: false,
      };
      if (apiDefinition.trim()) {
        metadata.api_definition = apiDefinition.trim().slice(0, 500_000);
      }

      const hcConfig = buildHealthcheckConfig(authTemplate, fieldValues);

      await createConnectorDefinition({
        name: serviceType,
        label: name,
        color: '#F59E0B',
        category: 'custom',
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
      setError(err instanceof Error ? err.message : 'Failed to save custom connection');
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
        <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/25 flex items-center justify-center">
          <Link className="w-4.5 h-4.5 text-amber-400" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">Custom Connection</h3>
          <p className="text-xs text-muted-foreground/60">URL + authentication with optional API definition</p>
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
          placeholder="My API Service"
          className="w-full px-3 py-2 bg-background/50 border border-border/50 rounded-xl text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all placeholder-muted-foreground/30"
        />
      </div>

      {/* Auth Template */}
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground/50 mb-3">
          Authentication Method
        </label>
        <div className="grid grid-cols-2 gap-2">
          {AUTH_TEMPLATES.map((tmpl) => (
            <button
              key={tmpl.id}
              onClick={() => { setAuthTemplate(tmpl.id); healthcheck.reset(); }}
              className={`text-left px-3 py-2.5 rounded-xl text-sm border transition-all ${
                authTemplate === tmpl.id
                  ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                  : 'bg-secondary/25 border-primary/15 text-muted-foreground/80 hover:bg-secondary/40'
              }`}
            >
              <div className="font-medium text-xs">{tmpl.label}</div>
              <div className="text-xs text-muted-foreground/50 mt-0.5">{tmpl.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Credential Fields */}
      <div className="border-t border-primary/8" />
      <CredentialEditForm
        fields={TEMPLATE_FIELDS[authTemplate]}
        onSave={handleSave}
        onCancel={onBack}
        onHealthcheck={handleHealthcheck}
        isHealthchecking={healthcheck.isHealthchecking}
        healthcheckResult={healthcheck.healthcheckResult}
      />

      {/* Optional API Definition */}
      <div className="border-t border-primary/8" />
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/50 mb-3">
          API Definition (Optional)
        </h4>
        <textarea
          value={apiDefinition}
          onChange={(e) => setApiDefinition(e.target.value)}
          placeholder="Paste OpenAPI/Swagger JSON or YAML here, or describe the API endpoints in plain text..."
          rows={4}
          className="w-full px-3 py-2 bg-background/50 border border-border/50 rounded-xl text-foreground text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all placeholder-muted-foreground/30 resize-y"
        />
        <p className="mt-1 text-xs text-muted-foreground/60">
          Helps AI understand available endpoints. Max 500KB.
        </p>
      </div>

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}
    </motion.div>
  );
}

function buildHealthcheckConfig(
  template: AuthTemplate,
  values: Record<string, string>,
): { endpoint: string; method: string; headers: Record<string, string>; description: string } | null {
  const baseUrl = values.base_url?.trim();
  if (!baseUrl) return null;

  const headers: Record<string, string> = {};

  switch (template) {
    case 'api-key': {
      const headerName = values.header_name?.trim() || 'X-API-Key';
      headers[headerName] = `{{api_key}}`;
      break;
    }
    case 'bearer':
      headers['Authorization'] = 'Bearer {{bearer_token}}';
      break;
    case 'basic':
      headers['Authorization'] = 'Basic {{username}}:{{password}}';
      break;
    case 'custom-headers':
      if (values.header_1_name?.trim()) {
        headers[values.header_1_name.trim()] = '{{header_1_value}}';
      }
      if (values.header_2_name?.trim()) {
        headers[values.header_2_name.trim()] = '{{header_2_value}}';
      }
      break;
  }

  return {
    endpoint: baseUrl,
    method: 'GET',
    headers,
    description: `Healthcheck for custom connection`,
  };
}
