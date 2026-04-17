import { Plug, Bot, Monitor, ArrowLeft } from 'lucide-react';
import { ThemedConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import type { ConnectorDefinition, ConnectorAuthMethod } from '@/lib/types/types';
import { isDesktopBridge } from '@/lib/utils/platform/connectors';
import { useTranslation } from '@/i18n/useTranslation';

interface TemplateFormHeaderProps {
  selectedConnector: ConnectorDefinition;
  activeMethod: ConnectorAuthMethod | undefined;
  onBack?: () => void;
  onAutoSetup?: () => void;
  onDesktopDetect?: () => void;
}

export function TemplateFormHeader({
  selectedConnector,
  activeMethod,
  onBack,
  onAutoSetup,
  onDesktopDetect,
}: TemplateFormHeaderProps) {
  const { t, tx } = useTranslation();
  return (
    <div className="flex items-center gap-3 mb-4">
      {onBack && (
        <button
          onClick={onBack}
          className="p-2 -ml-2 rounded-card hover:bg-secondary/50 transition-colors"
          title={t.vault.credential_forms.back_to_catalog}
        >
          <ArrowLeft className="w-4 h-4 text-foreground" />
        </button>
      )}
      <div
        className="w-10 h-10 rounded-modal flex items-center justify-center border"
        style={{
          backgroundColor: `${selectedConnector.color}15`,
          borderColor: `${selectedConnector.color}30`,
        }}
      >
        {selectedConnector.icon_url ? (
          <ThemedConnectorIcon url={selectedConnector.icon_url} label={selectedConnector.label} color={selectedConnector.color} size="w-5 h-5" />
        ) : (
          <Plug className="w-5 h-5" style={{ color: selectedConnector.color }} />
        )}
      </div>
      <div className="flex-1">
        <h4 className="font-medium text-foreground">{tx(t.vault.credential_forms.new_credential, { label: selectedConnector.label })}</h4>
        <p className="typo-body text-foreground">
          {activeMethod?.type === 'mcp'
            ? 'Configure MCP server connection'
            : selectedConnector.healthcheck_config?.description || t.vault.credential_forms.configure_fields}
        </p>
      </div>
      {isDesktopBridge(selectedConnector) ? (
        onDesktopDetect && (
          <button
            onClick={onDesktopDetect}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-modal border border-orange-500/20 bg-orange-500/8 hover:bg-orange-500/15 text-orange-300 typo-body font-medium transition-colors"
          >
            <Monitor className="w-3.5 h-3.5" />
            Detect
          </button>
        )
      ) : (
        onAutoSetup && activeMethod?.type !== 'mcp' && (
          <button
            onClick={onAutoSetup}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-modal border border-cyan-500/20 bg-cyan-500/8 hover:bg-cyan-500/15 text-cyan-300 typo-body font-medium transition-colors"
          >
            <Bot className="w-3.5 h-3.5" />
            Auto Add
          </button>
        )
      )}
    </div>
  );
}
