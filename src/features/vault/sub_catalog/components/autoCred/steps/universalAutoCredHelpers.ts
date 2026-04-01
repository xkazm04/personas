import type { CredentialDesignResult, CredentialDesignConnector } from '@/hooks/design/credential/useCredentialDesign';

/** Build a synthetic CredentialDesignResult for universal mode. */
export function buildUniversalDesignResult(serviceUrl: string, description: string): CredentialDesignResult {
  // Derive a label from the URL
  let label = 'Service';
  try {
    const hostname = new URL(serviceUrl).hostname.replace('www.', '');
    const parts = hostname.split('.');
    label = parts[0]!.charAt(0).toUpperCase() + parts[0]!.slice(1);
  } catch { /* use default */ }

  const connector: CredentialDesignConnector = {
    name: `__universal_${label.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
    label,
    category: 'api',
    color: '#6366f1',
    fields: [],
    healthcheck_config: null,
    services: [],
    events: [],
  };

  return {
    match_existing: null,
    connector,
    setup_instructions: description,
    summary: `Universal credential for ${label}`,
    _universalServiceUrl: serviceUrl,
    _universalDescription: description,
  } as CredentialDesignResult & { _universalServiceUrl: string; _universalDescription: string };
}
