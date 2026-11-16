import { Plug, Bot, Monitor, ArrowLeft } from 'lucide-react';
import { ThemedConnectorIcon } from '@/lib/connectors/connectorMeta';
import type { ConnectorDefinition, ConnectorAuthMethod } from '@/lib/types/types';
import { isDesktopBridge } from '@/lib/utils/platform/connectors';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import Button from '@/features/shared/components/buttons/Button';

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
  const cf = t.vault.forms;
  return (
    <div className="flex items-center gap-3 mb-4">
      {onBack && (
        <Tooltip content={cf.back_to_catalog}>
        <Button
          type="button"
          onClick={onBack}
          variant="ghost"
          size="icon-sm"
          className="-ml-2"
          aria-label={cf.back_to_catalog}
        >
          <ArrowLeft className="w-4 h-4 text-foreground" />
        </Button>
        </Tooltip>
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
        <h4 className="font-medium text-foreground">{tx(cf.new_credential, { label: selectedConnector.label })}</h4>
        <p className="typo-body text-foreground">
          {activeMethod?.type === 'mcp'
            ? cf.configure_mcp
            : selectedConnector.healthcheck_config?.description || cf.configure_fields}
        </p>
      </div>
      {isDesktopBridge(selectedConnector) ? (
        onDesktopDetect && (
          <Button
            type="button"
            onClick={onDesktopDetect}
            variant="accent"
            tone="warning"
            size="sm"
            icon={<Monitor className="w-3.5 h-3.5" />}
          >
            {cf.detect}
          </Button>
        )
      ) : (
        onAutoSetup && activeMethod?.type !== 'mcp' && (
          <Button
            type="button"
            onClick={onAutoSetup}
            data-testid="vault-auto-add-btn"
            variant="accent"
            tone="highlight"
            size="sm"
            icon={<Bot className="w-3.5 h-3.5" />}
          >
            {cf.auto_add}
          </Button>
        )
      )}
    </div>
  );
}
