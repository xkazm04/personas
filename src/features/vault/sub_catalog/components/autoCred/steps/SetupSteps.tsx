import { Monitor, Plug, ArrowLeft, Bot, MessageSquare } from 'lucide-react';
import { ThemedConnectorIcon } from '@/lib/connectors/connectorMeta';
import type { ConnectorDefinition } from '@/lib/types/types';
import type { AutoCredMode } from '../helpers/types';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';

interface DesktopBridgeBlockProps {
  connector: ConnectorDefinition;
  onCancel: () => void;
}

export function DesktopBridgeBlock({ connector, onCancel }: DesktopBridgeBlockProps) {
  const { t, tx } = useTranslation();
  return (
    <div
      className="animate-fade-slide-in bg-surface-2 backdrop-blur-sm border border-status-warning/15 rounded-modal p-6 space-y-4"
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-modal flex items-center justify-center border bg-status-warning/10 border-status-warning/20">
          <Monitor className="w-5 h-5 text-status-warning" />
        </div>
        <div className="flex-1">
          <h4 className="font-medium text-foreground">{tx(t.vault.auto_cred_extra.desktop_bridge_title, { label: connector.label })}</h4>
          <p className="typo-body text-foreground">
            {t.vault.auto_cred_extra.desktop_bridge_hint}
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          onClick={onCancel}
          variant="ghost"
          size="md"
        >
          {t.common.back}
        </Button>
      </div>
    </div>
  );
}

interface SetupHeaderProps {
  connector: ConnectorDefinition;
  mode: AutoCredMode;
  phase: string;
  onCancel: () => void;
}

export function SetupHeader({ connector, mode, phase, onCancel }: SetupHeaderProps) {
  const { t, tx } = useTranslation();
  return (
    <div className="flex items-center gap-3">
      <Button
        type="button"
        onClick={onCancel}
        variant="ghost"
        size="icon-sm"
      >
        <ArrowLeft className="w-4 h-4 text-foreground" />
      </Button>
      <div
        className="w-10 h-10 rounded-modal flex items-center justify-center border"
        style={{
          backgroundColor: `${connector.color}15`,
          borderColor: `${connector.color}30`,
        }}
      >
        {connector.icon_url ? (
          <ThemedConnectorIcon url={connector.icon_url} label={connector.label} color={connector.color} size="w-5 h-5" />
        ) : (
          <Plug className="w-5 h-5" style={{ color: connector.color }} />
        )}
      </div>
      <div className="flex-1">
        <h4 className="font-medium text-foreground">{tx(t.vault.auto_cred_extra.auto_setup_label, { label: connector.label })}</h4>
        <p className="typo-body text-foreground">
          {phase === 'analyzing' ? t.vault.auto_cred_extra.analyzing_setup : t.vault.auto_cred_extra.browser_hint}
        </p>
      </div>
      {mode === 'guided' ? (
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-card bg-role-agent/10 border border-role-agent/20">
          <MessageSquare className="w-3 h-3 text-role-agent" />
          <span className="typo-caption text-role-agent">{t.vault.auto_cred_extra.guided_badge}</span>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-card bg-role-highlight/10 border border-role-highlight/20">
          <Bot className="w-3 h-3 text-role-highlight" />
          <span className="typo-caption text-role-highlight">{t.vault.auto_cred_extra.playwright_badge}</span>
        </div>
      )}
    </div>
  );
}
