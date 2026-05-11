import { useEffect, useMemo } from 'react';
import { Key, CheckCircle2, AlertCircle, CircleHelp } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { useAgentStore } from '@/stores/agentStore';
import { useVaultStore } from '@/stores/vaultStore';
import { useSystemStore } from '@/stores/systemStore';

import type { CockpitWidgetProps } from '../widgetRegistry';

/**
 * Connected services — credentials in the vault + how many personas reference
 * each one + a health pill (ok / warn / unknown). Click navigates to the
 * Connections page.
 *
 * Config:
 *   { "limit": N }
 */
export function ConnectedServicesWidget({ config, title }: CockpitWidgetProps) {
  const limit = (config?.limit as number) ?? 8;

  const { credentials, fetchCredentials } = useVaultStore(
    useShallow((s) => ({ credentials: s.credentials, fetchCredentials: s.fetchCredentials })),
  );
  const personas = useAgentStore((s) => s.personas);

  useEffect(() => {
    if (!credentials || credentials.length === 0) {
      fetchCredentials().catch(() => {});
    }
  }, [credentials, fetchCredentials]);

  /**
   * Build usage counts: for each credential id, count personas whose
   * `design_context.credentialLinks` map points to it. The schema is JSON
   * TEXT — we parse defensively.
   */
  const usageByCredentialId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of personas ?? []) {
      const raw = p.design_context;
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const links = parsed.credentialLinks;
        if (links && typeof links === 'object') {
          for (const credId of Object.values(links as Record<string, unknown>)) {
            if (typeof credId === 'string' && credId.length > 0) {
              counts.set(credId, (counts.get(credId) ?? 0) + 1);
            }
          }
        }
      } catch {
        // Malformed design_context — skip silently.
      }
    }
    return counts;
  }, [personas]);

  const rows = useMemo(() => {
    const arr = credentials ?? [];
    return arr.slice(0, limit);
  }, [credentials, limit]);

  const openConnections = () => {
    useSystemStore.getState().setSidebarSection('credentials');
  };

  return (
    <div className="rounded-card border border-foreground/10 bg-foreground/[0.02] p-4 h-full flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-3">
        <div className="typo-caption text-foreground/60 uppercase tracking-wide">
          {title ?? 'Connected services'}
        </div>
        <button
          type="button"
          onClick={openConnections}
          className="typo-caption text-foreground/50 hover:text-foreground/80 transition-colors"
        >
          {credentials?.length ?? 0} total →
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-foreground/40">
          <Key className="w-6 h-6" />
          <div className="typo-caption">No connections yet</div>
        </div>
      ) : (
        <ul className="flex-1 space-y-1 overflow-y-auto">
          {rows.map((c) => {
            const used = usageByCredentialId.get(c.id) ?? 0;
            const status = c.healthcheck_last_success === true
              ? 'ok'
              : c.healthcheck_last_success === false
                ? 'warn'
                : 'unknown';
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={openConnections}
                  className="w-full flex items-center gap-2 rounded-input px-2 py-1.5 hover:bg-foreground/[0.04] transition-colors text-left"
                >
                  <HealthIcon status={status} />
                  <span className="typo-caption truncate flex-1 text-foreground/85">{c.name}</span>
                  <span className="typo-caption text-foreground/50 tabular-nums">
                    {used > 0 ? `${used} persona${used === 1 ? '' : 's'}` : '—'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function HealthIcon({ status }: { status: 'ok' | 'warn' | 'unknown' }) {
  if (status === 'ok') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
  if (status === 'warn') return <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />;
  return <CircleHelp className="w-3.5 h-3.5 text-foreground/30 shrink-0" />;
}
