import { Key, LayoutTemplate, Sparkles, Plug, ArrowRight, Globe } from 'lucide-react';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { ThemedConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import type { ConnectorDefinition } from '@/lib/types/types';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import { QUICK_START_SERVICES } from './credentialListTypes';
import { useTranslation } from '@/i18n/useTranslation';

interface EmptyStateViewProps {
  connectorDefinitions: ConnectorDefinition[];
  onQuickStart?: (connector: ConnectorDefinition) => void;
  onGoToCatalog?: () => void;
  onGoToAddNew?: () => void;
  onWorkspaceConnect?: () => void;
}

export function EmptyStateView({ connectorDefinitions, onQuickStart, onGoToCatalog, onGoToAddNew, onWorkspaceConnect }: EmptyStateViewProps) {
  const { t } = useTranslation();
  const quickConnectors = QUICK_START_SERVICES
    .map((name) => connectorDefinitions.find((c) => c.name.toLowerCase().includes(name)))
    .filter((c): c is ConnectorDefinition => c != null);

  return (
    <div
      className="animate-fade-slide-in space-y-4"
    >
      {/* Heading */}
      <div className="pt-6 pb-2">
        <EmptyIllustration
          icon={Key}
          heading={t.vault.empty_state.heading}
          description={t.vault.empty_state.description}
        />
      </div>

      {/* Two pathway cards */}
      <div className="grid gap-3" style={{ gridTemplateColumns: IS_MOBILE ? '1fr' : 'repeat(auto-fill, minmax(300px, 1fr))' }}>
        {/* Catalog path */}
        <button
          onClick={() => onGoToCatalog?.()}
          className="group text-left p-4 rounded-xl border border-primary/15 bg-secondary/25 hover:bg-secondary/50 hover:border-primary/25 transition-all"
        >
          <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-3">
            <LayoutTemplate className="w-4.5 h-4.5 text-emerald-400" />
          </div>
          <p className="text-sm font-medium text-foreground/80 mb-1">{t.vault.empty_state.catalog_heading}</p>
          <p className="text-sm text-muted-foreground/90 leading-relaxed">
            {t.vault.empty_state.catalog_description}
          </p>
          <div className="flex items-center gap-1.5 mt-3">
            {connectorDefinitions.slice(0, 4).map((c) => (
              <div
                key={c.id}
                className="w-5 h-5 rounded border flex items-center justify-center"
                style={{
                  backgroundColor: `${c.color}12`,
                  borderColor: `${c.color}25`,
                }}
                title={c.label}
              >
                {c.icon_url ? (
                  <ThemedConnectorIcon url={c.icon_url} label={c.label} color={c.color} size="w-3 h-3" />
                ) : (
                  <Plug className="w-2.5 h-2.5" style={{ color: c.color }} />
                )}
              </div>
            ))}
            {connectorDefinitions.length > 4 && (
              <span className="text-sm text-muted-foreground/80 ml-0.5">+{connectorDefinitions.length - 4}</span>
            )}
          </div>
        </button>

        {/* AI design path */}
        <button
          data-testid="create-credential-btn"
          onClick={() => onGoToAddNew?.()}
          className="group text-left p-4 rounded-xl border border-primary/15 bg-secondary/25 hover:bg-secondary/50 hover:border-primary/25 transition-all"
        >
          <div className="w-9 h-9 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mb-3">
            <Sparkles className="w-4.5 h-4.5 text-violet-400" />
          </div>
          <p className="text-sm font-medium text-foreground/80 mb-1">{t.vault.empty_state.ai_heading}</p>
          <p className="text-sm text-muted-foreground/90 leading-relaxed">
            {t.vault.empty_state.ai_description}
          </p>
          <span className="inline-flex items-center gap-1 mt-3 text-sm text-violet-400/60 group-hover:text-violet-400/80 transition-colors">
            {t.vault.empty_state.works_with_any} <ArrowRight className="w-3 h-3" />
          </span>
        </button>
      </div>

      {/* Workspace Connect */}
      {onWorkspaceConnect && (
        <button
          onClick={onWorkspaceConnect}
          className="w-full text-left p-4 rounded-xl bg-gradient-to-r from-blue-500/5 to-emerald-500/5 border border-blue-500/15 hover:from-blue-500/10 hover:to-emerald-500/10 hover:border-blue-500/25 transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
              <Globe className="w-4.5 h-4.5 text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground/80">{t.vault.workspace_connect}</p>
              <p className="text-sm text-muted-foreground/60">
                {t.vault.type_picker.workspace_connect_hint}
              </p>
            </div>
          </div>
        </button>
      )}

      {/* Quick-start row */}
      {quickConnectors.length > 0 && onQuickStart && (
        <div className="space-y-2">
          <p className="text-sm font-mono uppercase tracking-wider text-muted-foreground/80 text-center">{t.vault.quick_start}</p>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            {quickConnectors.map((connector) => (
              <button
                key={connector.id}
                onClick={() => onQuickStart(connector)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-primary/10 bg-secondary/20 hover:bg-secondary/50 hover:border-primary/20 transition-all text-sm"
              >
                <div
                  className="w-4.5 h-4.5 rounded flex items-center justify-center"
                  style={{ backgroundColor: `${connector.color}15` }}
                >
                  {connector.icon_url ? (
                    <ThemedConnectorIcon url={connector.icon_url} label={connector.label} color={connector.color} size="w-3 h-3" />
                  ) : (
                    <Plug className="w-2.5 h-2.5" style={{ color: connector.color }} />
                  )}
                </div>
                <span className="text-foreground/80">{connector.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
