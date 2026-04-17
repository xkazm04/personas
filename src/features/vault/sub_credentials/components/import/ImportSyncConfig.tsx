import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { ImportSourceId, SyncConfig } from './importTypes';
import { useTranslation } from '@/i18n/useTranslation';

interface ImportSyncConfigProps {
  sourceId: ImportSourceId;
  syncConfig: SyncConfig | null;
  onSyncConfigChange: (config: SyncConfig | null) => void;
}

export function ImportSyncConfig({ sourceId, syncConfig, onSyncConfigChange }: ImportSyncConfigProps) {
  const { t } = useTranslation();
  const ci = t.vault.credential_import;
  const [showSync, setShowSync] = useState(!!syncConfig);

  return (
    <div className="rounded-modal border border-cyan-500/15 bg-cyan-500/5 p-3 space-y-2.5">
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={showSync}
          onChange={(e) => {
            setShowSync(e.target.checked);
            if (!e.target.checked) onSyncConfigChange(null);
            else onSyncConfigChange({
              enabled: true,
              sourceId,
              sourceRef: '',
              intervalMinutes: 60,
            });
          }}
          className="rounded border-cyan-500/30 text-cyan-500 focus-visible:ring-cyan-500/30"
        />
        <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
        <span className="typo-body font-medium text-cyan-300">{ci.enable_sync}</span>
      </label>
      {showSync && syncConfig && (
        <div className="flex items-center gap-3 pl-6">
          <div className="flex-1">
            <label className="text-[11px] text-foreground">{ci.source_ref}</label>
            <input
              type="text"
              value={syncConfig.sourceRef}
              onChange={(e) => onSyncConfigChange({ ...syncConfig, sourceRef: e.target.value })}
              placeholder={
                sourceId === '1password' ? 'op://vault/item' :
                sourceId === 'aws_secrets' ? 'arn:aws:secretsmanager:...' :
                sourceId === 'azure_keyvault' ? 'https://myvault.vault.azure.net/...' :
                'project/config'
              }
              className="w-full px-2.5 py-1.5 rounded-card border border-cyan-500/20 bg-background/40 typo-body text-foreground placeholder-muted-foreground/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500/30"
            />
          </div>
          <div className="w-28">
            <label className="text-[11px] text-foreground">{ci.poll_interval}</label>
            <select
              value={syncConfig.intervalMinutes}
              onChange={(e) => onSyncConfigChange({ ...syncConfig, intervalMinutes: Number(e.target.value) })}
              className="w-full px-2.5 py-1.5 rounded-card border border-cyan-500/20 bg-background/40 typo-body text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-500/30"
            >
              <option value={15}>{ci.interval_15min}</option>
              <option value={30}>{ci.interval_30min}</option>
              <option value={60}>{ci.interval_1hr}</option>
              <option value={360}>{ci.interval_6hr}</option>
              <option value={1440}>{ci.interval_24hr}</option>
            </select>
          </div>
        </div>
      )}
      <p className="text-[11px] text-foreground pl-6">
        {ci.sync_hint}
      </p>
    </div>
  );
}
