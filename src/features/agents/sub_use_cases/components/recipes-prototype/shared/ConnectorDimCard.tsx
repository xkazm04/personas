import { useMemo } from 'react';
import { ChevronDown, Plug, Check, ExternalLink } from 'lucide-react';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import { useSelectedCredentialLinks } from '@/stores/selectors/personaSelectors';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { mutateCredentialLink } from '@/hooks/design/core/useDesignContextMutator';
import { useToastStore } from '@/stores/toastStore';
import { toastCatch } from '@/lib/silentCatch';
import { DIM_META } from '@/features/shared/glyph/dimMeta';
import { getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import { useTranslation } from '@/i18n/useTranslation';
import type { CredentialMetadata } from '@/lib/types/types';
import type { DisplayUseCase } from './displayUseCase';

interface ConnectorDimCardProps {
  uc: DisplayUseCase;
  personaId: string;
  credentials: CredentialMetadata[];
}

/**
 * Interactive Connector dim card — clickable, opens a Listbox of credentials
 * of the matching service_type so the user can re-bind which credential the
 * persona uses for this connector. Persists via `mutateCredentialLink`.
 *
 * Note: rebinding is *persona-scoped*, not use-case-scoped. The persona has
 * exactly one credential bound per connector type via `credentialLinks` —
 * changing the binding here affects every use case on the persona that
 * references the same connector. This matches how the legacy connectors
 * tab + agent build flow already work; we're surfacing it here as a
 * convenience instead of forcing the user out to the vault.
 *
 * When no credential of the matching type is wired (or none exists), the
 * card shows a "Wire in Vault →" link that jumps to the credentials surface.
 */
export function ConnectorDimCard({ uc, personaId, credentials }: ConnectorDimCardProps) {
  const fetchDetail = useAgentStore((s) => s.fetchDetail);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const credentialLinks = useSelectedCredentialLinks();
  const { t, tx } = useTranslation();
  const connectorKey = uc.connectorKey;
  const meta = connectorKey ? getConnectorMeta(connectorKey) : null;
  const dimColor = DIM_META.connector.color;

  const matchingCreds = useMemo(
    () => connectorKey
      ? credentials.filter((c) => c.service_type === connectorKey)
      : [],
    [credentials, connectorKey],
  );
  const currentCredId = connectorKey ? credentialLinks[connectorKey] : undefined;
  const currentCred = matchingCreds.find((c) => c.id === currentCredId);

  const active = uc.dimensions.includes('connector');

  const handleRebind = async (credId: string) => {
    if (!connectorKey) return;
    try {
      await mutateCredentialLink(personaId, connectorKey, credId);
      await fetchDetail(personaId);
      useToastStore.getState().addToast(t.agents.use_cases.connector_rebound_toast, 'success');
    } catch (err) {
      toastCatch('ConnectorDimCard:rebind')(err);
    }
  };

  // No connector to manage — fall back to the static read-only display.
  if (!connectorKey || !meta) {
    return (
      <ReadOnlyShell title={t.agents.use_cases.connector_dim_title} body={t.agents.use_cases.connector_not_configured} active={false} />
    );
  }

  const triggerBody = currentCred?.name ?? meta.label;
  const triggerSubtitle = currentCred
    ? null
    : matchingCreds.length === 0
      ? tx(t.agents.use_cases.connector_no_cred, { label: meta.label })
      : t.agents.use_cases.connector_select_cred;

  return (
    <Listbox
      ariaLabel={tx(t.agents.use_cases.connector_rebind_aria, { label: meta.label })}
      itemCount={matchingCreds.length}
      onSelectFocused={(i) => {
        const c = matchingCreds[i];
        if (c) void handleRebind(c.id);
      }}
      menuClassName="animate-fade-slide-in absolute top-full mt-1 left-0 right-0 bg-card-bg border border-card-border rounded-xl shadow-elevation-4 z-[100] overflow-hidden"
      renderTrigger={({ isOpen, toggle }) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); toggle(); }}
          aria-expanded={isOpen}
          className={`w-full text-left rounded-card border bg-secondary/30 px-3 py-2 transition-colors cursor-pointer hover:border-foreground/40 ${
            active ? 'border-card-border' : 'border-border/30 opacity-65 hover:opacity-100'
          }`}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <span
              className="flex items-center justify-center rounded"
              style={{
                width: 18, height: 18,
                background: active ? `${dimColor}1f` : 'rgba(148,163,184,0.12)',
                border: `1px solid ${active ? dimColor + '55' : 'rgba(148,163,184,0.25)'}`,
              }}
            >
              <Plug className="w-3 h-3" style={{ color: active ? dimColor : '#94a3b8' }} />
            </span>
            <span className="typo-label uppercase tracking-wider text-foreground">{t.agents.use_cases.connector_dim_title}</span>
            <ChevronDown className={`ml-auto w-3 h-3 text-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </div>
          <div className="flex items-center gap-2">
            <span className="typo-caption font-medium" style={{ color: meta.color }}>
              {meta.label}
            </span>
            {currentCred && (
              <span className="typo-caption text-foreground truncate">
                · {triggerBody === meta.label ? '' : triggerBody}
              </span>
            )}
          </div>
          {triggerSubtitle && (
            <div className="typo-caption text-foreground mt-0.5">{triggerSubtitle}</div>
          )}
        </button>
      )}
    >
      {({ close, focusIndex }) => (
        <div className="py-1 max-h-[40vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          <div className="px-3 pt-1.5 pb-1 typo-label uppercase tracking-wider text-foreground">
            {tx(t.agents.use_cases.connector_creds_group, { label: meta.label })}
          </div>
          {matchingCreds.length === 0 ? (
            <div className="px-3 py-3 typo-caption text-foreground">
              {t.agents.use_cases.connector_creds_empty}
            </div>
          ) : (
            matchingCreds.map((c, i) => {
              const isCurrent = c.id === currentCredId;
              const isFocused = focusIndex === i;
              const lastUsed = c.last_used_at
                ? formatRelative(c.last_used_at)
                : 'Never used';
              return (
                <button
                  key={c.id}
                  role="option"
                  aria-selected={isCurrent}
                  onClick={() => { void handleRebind(c.id); close(); }}
                  className={`flex items-start gap-2 w-full px-3 py-2 typo-caption transition-colors cursor-pointer text-left ${
                    isFocused ? 'bg-secondary/60' : 'hover:bg-secondary/40'
                  } ${isCurrent ? 'text-primary' : 'text-foreground'}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{c.name}</div>
                    <div className="typo-label uppercase tracking-wider text-foreground mt-0.5">
                      {t.agents.use_cases.connector_last_used} <span className="font-mono normal-case tracking-normal">{lastUsed}</span>
                    </div>
                  </div>
                  {isCurrent && <Check className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />}
                </button>
              );
            })
          )}
          <div className="border-t border-card-border/60 mt-1 pt-1">
            <button
              type="button"
              onClick={() => { setSidebarSection('credentials'); close(); }}
              className="flex items-center gap-2 w-full px-3 py-2 typo-caption text-foreground hover:text-foreground hover:bg-secondary/40 cursor-pointer"
            >
              <ExternalLink className="w-3 h-3" />
              {t.agents.use_cases.connector_manage_vault}
            </button>
          </div>
        </div>
      )}
    </Listbox>
  );
}

interface ReadOnlyShellProps {
  title: string;
  body: string;
  active: boolean;
}

/** Fallback shell that mirrors the standard DimCard for use cases without a
 *  resolvable connector (no tool_hints, or hints that don't match any
 *  CONNECTOR_META key). Stays read-only. */
function ReadOnlyShell({ title, body, active }: ReadOnlyShellProps) {
  const dimColor = DIM_META.connector.color;
  return (
    <div
      className={`rounded-card border bg-secondary/30 px-3 py-2 transition-opacity ${
        active ? 'border-card-border opacity-100' : 'border-border/30 opacity-55'
      }`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span
          className="flex items-center justify-center rounded"
          style={{
            width: 18, height: 18,
            background: active ? `${dimColor}1f` : 'rgba(148,163,184,0.12)',
            border: `1px solid ${active ? dimColor + '55' : 'rgba(148,163,184,0.25)'}`,
          }}
        >
          <Plug className="w-3 h-3" style={{ color: active ? dimColor : '#94a3b8' }} />
        </span>
        <span className="typo-label uppercase tracking-wider text-foreground">{title}</span>
      </div>
      <div className="typo-caption text-foreground/85 leading-snug">{body}</div>
    </div>
  );
}

function formatRelative(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const diff = now - then;
    const min = Math.floor(diff / 60_000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day}d ago`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}
