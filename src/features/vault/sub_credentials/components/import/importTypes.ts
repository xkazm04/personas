import type { CredentialDesignResult } from '@/hooks/design/credential/useCredentialDesign';

/** Supported external secret sources */
export type ImportSourceId = 'env_file' | '1password' | 'aws_secrets' | 'azure_keyvault' | 'doppler';

export interface ImportSourceMeta {
  id: ImportSourceId;
  label: string;
  description: string;
  color: string;
  icon: string; // lucide icon name hint
  cliCommand?: string;
  syncSupported: boolean;
}

export const IMPORT_SOURCES: ImportSourceMeta[] = [
  {
    id: 'env_file',
    label: '.env File',
    description: 'Import secrets from a local .env file',
    color: '#22C55E',
    icon: 'file-text',
    syncSupported: false,
  },
  {
    id: '1password',
    label: '1Password CLI',
    description: 'Import from 1Password using the op CLI',
    color: '#0572EC',
    icon: 'key-round',
    cliCommand: 'op',
    syncSupported: true,
  },
  {
    id: 'aws_secrets',
    label: 'AWS Secrets Manager',
    description: 'Import from AWS Secrets Manager',
    color: '#FF9900',
    icon: 'cloud',
    cliCommand: 'aws',
    syncSupported: true,
  },
  {
    id: 'azure_keyvault',
    label: 'Azure Key Vault',
    description: 'Import from Azure Key Vault',
    color: '#0078D4',
    icon: 'shield',
    cliCommand: 'az',
    syncSupported: true,
  },
  {
    id: 'doppler',
    label: 'Doppler',
    description: 'Import from Doppler SecretOps platform',
    color: '#7C3AED',
    icon: 'lock',
    cliCommand: 'doppler',
    syncSupported: true,
  },
];

/** A single parsed secret entry from any source */
export interface ImportedSecret {
  key: string;
  value: string;
  /** Original path/reference in the source vault */
  sourcePath?: string;
}

/** Result of parsing an import source */
export interface ImportParseResult {
  source: ImportSourceId;
  secrets: ImportedSecret[];
  errors: string[];
}

/** Auto-detected service mapping for an imported secret */
export interface SecretServiceMapping {
  secretKey: string;
  detectedService: string | null;
  connectorName: string | null;
  confidence: 'high' | 'medium' | 'low';
}

/** Sync configuration for external vault watching */
export interface SyncConfig {
  enabled: boolean;
  sourceId: ImportSourceId;
  /** Source-specific reference (vault path, secret ARN, etc.) */
  sourceRef: string;
  /** Polling interval in minutes */
  intervalMinutes: number;
}

/** Phase of the import flow */
export type ImportPhase = 'pick_source' | 'input' | 'preview' | 'importing' | 'done' | 'error';

/** State for the credential import flow */
export interface ImportFlowState {
  phase: ImportPhase;
  sourceId: ImportSourceId | null;
  rawInput: string;
  parseResult: ImportParseResult | null;
  mappings: SecretServiceMapping[];
  selectedKeys: Set<string>;
  syncConfig: SyncConfig | null;
  error: string | null;
}

// ---- Secret name to service detection ----

const SERVICE_PATTERNS: Array<{ pattern: RegExp; service: string; connector: string }> = [
  { pattern: /openai/i, service: 'OpenAI', connector: 'openai' },
  { pattern: /anthropic/i, service: 'Anthropic', connector: 'anthropic' },
  { pattern: /github/i, service: 'GitHub', connector: 'github' },
  { pattern: /gitlab/i, service: 'GitLab', connector: 'gitlab' },
  { pattern: /slack/i, service: 'Slack', connector: 'slack' },
  { pattern: /stripe/i, service: 'Stripe', connector: 'stripe' },
  { pattern: /twilio/i, service: 'Twilio', connector: 'twilio' },
  { pattern: /sendgrid/i, service: 'SendGrid', connector: 'sendgrid' },
  { pattern: /datadog/i, service: 'Datadog', connector: 'datadog' },
  { pattern: /notion/i, service: 'Notion', connector: 'notion' },
  { pattern: /aws/i, service: 'AWS', connector: 'aws' },
  { pattern: /azure/i, service: 'Azure', connector: 'azure' },
  { pattern: /gcp|google_cloud/i, service: 'Google Cloud', connector: 'gcp' },
  { pattern: /supabase/i, service: 'Supabase', connector: 'supabase' },
  { pattern: /firebase/i, service: 'Firebase', connector: 'firebase' },
  { pattern: /postgres|pg_/i, service: 'PostgreSQL', connector: 'postgresql' },
  { pattern: /mysql/i, service: 'MySQL', connector: 'mysql' },
  { pattern: /redis/i, service: 'Redis', connector: 'redis' },
  { pattern: /mongo/i, service: 'MongoDB', connector: 'mongodb' },
  { pattern: /sentry/i, service: 'Sentry', connector: 'sentry' },
  { pattern: /vercel/i, service: 'Vercel', connector: 'vercel' },
  { pattern: /heroku/i, service: 'Heroku', connector: 'heroku' },
  { pattern: /cloudflare/i, service: 'Cloudflare', connector: 'cloudflare' },
  { pattern: /jira/i, service: 'Jira', connector: 'jira' },
  { pattern: /confluence/i, service: 'Confluence', connector: 'confluence' },
  { pattern: /linear/i, service: 'Linear', connector: 'linear' },
  { pattern: /discord/i, service: 'Discord', connector: 'discord' },
  { pattern: /telegram/i, service: 'Telegram', connector: 'telegram' },
  { pattern: /mailgun/i, service: 'Mailgun', connector: 'mailgun' },
  { pattern: /hubspot/i, service: 'HubSpot', connector: 'hubspot' },
  { pattern: /salesforce/i, service: 'Salesforce', connector: 'salesforce' },
  { pattern: /shopify/i, service: 'Shopify', connector: 'shopify' },
];

/** Detect service from a secret key/path name */
export function detectServiceFromKey(key: string): SecretServiceMapping {
  for (const { pattern, service, connector } of SERVICE_PATTERNS) {
    if (pattern.test(key)) {
      return { secretKey: key, detectedService: service, connectorName: connector, confidence: 'high' };
    }
  }
  // Check for generic patterns
  if (/api[_-]?key|token|secret/i.test(key)) {
    return { secretKey: key, detectedService: null, connectorName: null, confidence: 'low' };
  }
  return { secretKey: key, detectedService: null, connectorName: null, confidence: 'low' };
}

/** Parse .env file content into secrets */
export function parseEnvFile(content: string): ImportParseResult {
  const secrets: ImportedSecret[] = [];
  const errors: string[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      errors.push(`Invalid line (no = sign): ${trimmed.slice(0, 40)}`);
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key && value) {
      secrets.push({ key, value });
    }
  }

  return { source: 'env_file', secrets, errors };
}

/** Parse 1Password CLI JSON output (op item list --format=json) */
export function parse1PasswordOutput(jsonStr: string): ImportParseResult {
  const errors: string[] = [];
  const secrets: ImportedSecret[] = [];

  try {
    const items = JSON.parse(jsonStr);
    if (!Array.isArray(items)) {
      return { source: '1password', secrets: [], errors: ['Expected a JSON array from op CLI output'] };
    }
    for (const item of items) {
      const title = item.title ?? item.label ?? 'unknown';
      const fields = item.fields ?? [];
      for (const field of fields) {
        if (field.value && field.label !== 'username') {
          secrets.push({
            key: `${title}_${field.label ?? field.id}`.replace(/\s+/g, '_').toUpperCase(),
            value: field.value,
            sourcePath: `op://${item.vault?.name ?? 'vault'}/${title}/${field.label ?? field.id}`,
          });
        }
      }
    }
  } catch {
    errors.push('Failed to parse 1Password JSON output. Use: op item list --format=json');
  }

  return { source: '1password', secrets, errors };
}

/** Parse AWS Secrets Manager JSON (aws secretsmanager get-secret-value) */
export function parseAwsSecretsOutput(jsonStr: string): ImportParseResult {
  const errors: string[] = [];
  const secrets: ImportedSecret[] = [];

  try {
    const data = JSON.parse(jsonStr);
    const secretString = data.SecretString;
    if (typeof secretString === 'string') {
      try {
        const parsed = JSON.parse(secretString);
        for (const [key, val] of Object.entries(parsed)) {
          if (typeof val === 'string') {
            secrets.push({ key, value: val, sourcePath: data.ARN ?? data.Name });
          }
        }
      } catch {
        // If SecretString is plain text
        const name = data.Name ?? 'AWS_SECRET';
        secrets.push({ key: name.replace(/[/\s]/g, '_').toUpperCase(), value: secretString, sourcePath: data.ARN });
      }
    } else {
      errors.push('No SecretString found in AWS response');
    }
  } catch {
    errors.push('Failed to parse AWS Secrets Manager JSON output');
  }

  return { source: 'aws_secrets', secrets, errors };
}

/** Parse Azure Key Vault JSON (az keyvault secret list / show) */
export function parseAzureKeyVaultOutput(jsonStr: string): ImportParseResult {
  const errors: string[] = [];
  const secrets: ImportedSecret[] = [];

  try {
    const data = JSON.parse(jsonStr);
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      if (item.value) {
        const name = item.name ?? item.id?.split('/')?.pop() ?? 'AZURE_SECRET';
        secrets.push({
          key: name.replace(/[-\s]/g, '_').toUpperCase(),
          value: item.value,
          sourcePath: item.id,
        });
      }
    }
  } catch {
    errors.push('Failed to parse Azure Key Vault JSON output');
  }

  return { source: 'azure_keyvault', secrets, errors };
}

/** Parse Doppler CLI JSON output (doppler secrets download --format=json) */
export function parseDopplerOutput(jsonStr: string): ImportParseResult {
  const errors: string[] = [];
  const secrets: ImportedSecret[] = [];

  try {
    const data = JSON.parse(jsonStr);
    for (const [key, val] of Object.entries(data)) {
      // Doppler returns { KEY: { raw: "value", computed: "value" } } or plain { KEY: "value" }
      const value = typeof val === 'string' ? val : (val as Record<string, string>)?.computed ?? (val as Record<string, string>)?.raw;
      if (typeof value === 'string' && !key.startsWith('DOPPLER_')) {
        secrets.push({ key, value, sourcePath: `doppler://${key}` });
      }
    }
  } catch {
    errors.push('Failed to parse Doppler JSON output. Use: doppler secrets download --format=json');
  }

  return { source: 'doppler', secrets, errors };
}

/** Route raw input to the correct parser */
export function parseImportInput(sourceId: ImportSourceId, input: string): ImportParseResult {
  switch (sourceId) {
    case 'env_file': return parseEnvFile(input);
    case '1password': return parse1PasswordOutput(input);
    case 'aws_secrets': return parseAwsSecretsOutput(input);
    case 'azure_keyvault': return parseAzureKeyVaultOutput(input);
    case 'doppler': return parseDopplerOutput(input);
  }
}

/** Build auto-detected mappings for a set of imported secrets */
export function buildMappings(secrets: ImportedSecret[]): SecretServiceMapping[] {
  return secrets.map((s) => detectServiceFromKey(s.key));
}

/** Group secrets by their detected service */
export function groupByService(
  secrets: ImportedSecret[],
  mappings: SecretServiceMapping[],
): Map<string, ImportedSecret[]> {
  const groups = new Map<string, ImportedSecret[]>();
  for (let i = 0; i < secrets.length; i++) {
    const service = mappings[i]?.detectedService ?? 'Unrecognized';
    if (!groups.has(service)) groups.set(service, []);
    groups.get(service)!.push(secrets[i]!);
  }
  return groups;
}

/** Build a CredentialDesignResult from imported secrets for a given service */
export function buildDesignResultFromImport(
  serviceName: string,
  connectorName: string,
  secrets: ImportedSecret[],
): CredentialDesignResult {
  return {
    match_existing: null,
    connector: {
      name: connectorName,
      label: serviceName,
      category: 'imported',
      color: '#6366F1',
      fields: secrets.map((s) => ({
        key: s.key,
        label: s.key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        type: /secret|key|token|password/i.test(s.key) ? 'password' : 'text',
        required: true,
        placeholder: `Imported from external vault`,
      })),
      healthcheck_config: null,
      services: [],
      events: [],
    },
    setup_instructions: `Imported from external vault. ${secrets.length} field(s) auto-populated.`,
    summary: `${serviceName} credential imported from external secret manager`,
  };
}
