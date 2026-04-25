/**
 * BackgroundServices — lazy-loaded component that activates background hooks.
 *
 * These hooks import from domain stores (agentStore, vaultStore, overviewStore)
 * which cascade ~300 KB of API + slice code. By lazy-loading this component,
 * that code is deferred out of the main bundle and loaded after first paint.
 *
 * Renders nothing — purely a hook host.
 */

import { useLabEvents } from "@/hooks/lab/useLabEvents";
import { useHealthDigestScheduler, useHealthDigestPrefetch } from "@/features/agents/health";
import { useCredentialRemediation } from "@/features/vault/shared/hooks/health/useCredentialRemediation";


export default function BackgroundServices() {
  useLabEvents();
  useHealthDigestScheduler();
  useHealthDigestPrefetch();
  useCredentialRemediation();
  return null;
}
