import { useMemo } from 'react';
import { parseDesignContext } from '@/features/shared/components/use-cases/UseCasesList';
import { extractProtocolCapabilities } from '../edit/protocolParser';
import type { DesignContextData } from '@/lib/types/frontendTypes';
import type { ProtocolCapability } from '@/lib/types/designTypes';

interface N8nDesignData {
  contextData: DesignContextData;
  credentialLinks: Record<string, string>;
  capabilities: ProtocolCapability[];
}

/**
 * Shared hook that memoizes `parseDesignContext` and `extractProtocolCapabilities`
 * so sibling n8n components receive consistent, pre-computed values.
 */
export function useN8nDesignData(
  designContext: string | null | undefined,
  systemPrompt: string | null | undefined,
  structuredPrompt: Record<string, unknown> | null | undefined,
): N8nDesignData {
  const contextData = useMemo(
    () => parseDesignContext(designContext),
    [designContext],
  );

  const credentialLinks = useMemo(
    () => contextData.credentialLinks ?? {},
    [contextData],
  );

  const capabilities = useMemo(
    () => extractProtocolCapabilities(systemPrompt, structuredPrompt),
    [systemPrompt, structuredPrompt],
  );

  return { contextData, credentialLinks, capabilities };
}
