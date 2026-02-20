export const QUICK_SERVICE_HINTS = [
  'OpenAI API key',
  'GitHub personal access token',
  'Slack bot token',
  'Stripe secret key',
  'Notion integration token',
  'Datadog API key',
];

export interface RuntimeHealthcheckConfig {
  endpoint: string;
  method: string;
  headers: Record<string, string>;
  expected_status?: number;
  description?: string;
}

export function extractFirstUrl(text?: string): string | null {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s)]+/i);
  return match ? match[0] : null;
}

export function resolveTemplate(template: string, values: Record<string, string>): string {
  let resolved = template;
  for (const [key, value] of Object.entries(values)) {
    resolved = resolved.replaceAll(`{{${key}}}`, value);
  }
  return resolved;
}

export function normalizeHealthcheckConfig(raw: unknown): RuntimeHealthcheckConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const cfg = raw as Record<string, unknown>;

  const endpoint = (typeof cfg.endpoint === 'string' ? cfg.endpoint : null)
    ?? (typeof cfg.url === 'string' ? cfg.url : null);

  if (!endpoint) return null;

  const method = typeof cfg.method === 'string' ? cfg.method.toUpperCase() : 'GET';

  const headers: Record<string, string> = {};
  if (cfg.headers && typeof cfg.headers === 'object') {
    for (const [key, value] of Object.entries(cfg.headers as Record<string, unknown>)) {
      if (typeof value === 'string') {
        headers[key] = value;
      }
    }
  }

  return {
    endpoint,
    method,
    headers,
    expected_status: typeof cfg.expected_status === 'number' ? cfg.expected_status : undefined,
    description: typeof cfg.description === 'string' ? cfg.description : undefined,
  };
}
