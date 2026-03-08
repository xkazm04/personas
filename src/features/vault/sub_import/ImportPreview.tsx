import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, AlertTriangle, Import, RefreshCw } from 'lucide-react';
import {
  IMPORT_SOURCES,
  type ImportSourceId,
  type ImportedSecret,
  type SecretServiceMapping,
  type SyncConfig,
  groupByService,
} from './importTypes';

interface ImportPreviewProps {
  sourceId: ImportSourceId;
  secrets: ImportedSecret[];
  mappings: SecretServiceMapping[];
  selectedKeys: Set<string>;
  errors: string[];
  syncConfig: SyncConfig | null;
  onToggleKey: (key: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onImport: () => void;
  onSyncConfigChange: (config: SyncConfig | null) => void;
  onBack: () => void;
}

export function ImportPreview({
  sourceId,
  secrets,
  mappings,
  selectedKeys,
  errors,
  syncConfig,
  onToggleKey,
  onSelectAll,
  onDeselectAll,
  onImport,
  onSyncConfigChange,
  onBack,
}: ImportPreviewProps) {
  const source = IMPORT_SOURCES.find((s) => s.id === sourceId)!;
  const groups = groupByService(secrets, mappings);
  const selectedCount = selectedKeys.size;
  const [showSync, setShowSync] = useState(!!syncConfig);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h3 className="text-sm font-medium text-foreground">
              {secrets.length} secret{secrets.length !== 1 ? 's' : ''} found
            </h3>
            <p className="text-sm text-muted-foreground/70">
              {selectedCount} selected for import
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onSelectAll} className="text-sm text-primary hover:underline">Select all</button>
          <span className="text-muted-foreground/40">|</span>
          <button onClick={onDeselectAll} className="text-sm text-muted-foreground hover:text-foreground hover:underline">None</button>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="p-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 text-sm text-amber-300 space-y-1">
          {errors.map((err, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>{err}</span>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3 max-h-[340px] overflow-y-auto pr-1">
        {[...groups.entries()].map(([service, groupSecrets]) => {
          const mapping = mappings.find((m) => m.detectedService === service);
          return (
            <div key={service} className="rounded-xl border border-primary/10 bg-secondary/15 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/8 bg-secondary/10">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{
                    backgroundColor:
                      mapping?.confidence === 'high' ? '#22C55E'
                      : mapping?.confidence === 'medium' ? '#F59E0B'
                      : '#6B7280',
                  }}
                />
                <span className="text-sm font-medium text-foreground">{service}</span>
                {mapping?.confidence === 'high' && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/15">
                    Auto-detected
                  </span>
                )}
              </div>
              <div className="divide-y divide-primary/5">
                {groupSecrets.map((secret) => {
                  const isSelected = selectedKeys.has(secret.key);
                  return (
                    <label
                      key={secret.key}
                      className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-secondary/30 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleKey(secret.key)}
                        className="rounded border-primary/30 text-primary focus:ring-primary/30"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-mono text-foreground truncate">{secret.key}</p>
                        {secret.sourcePath && (
                          <p className="text-[11px] text-muted-foreground/50 truncate">{secret.sourcePath}</p>
                        )}
                      </div>
                      <span className="text-sm text-muted-foreground/40 font-mono">
                        {secret.value.slice(0, 4)}{'...'}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Sync toggle */}
      {source.syncSupported && (
        <div className="rounded-xl border border-cyan-500/15 bg-cyan-500/5 p-3 space-y-2.5">
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
              className="rounded border-cyan-500/30 text-cyan-500 focus:ring-cyan-500/30"
            />
            <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-sm font-medium text-cyan-300">Enable sync mode</span>
          </label>
          {showSync && syncConfig && (
            <div className="flex items-center gap-3 pl-6">
              <div className="flex-1">
                <label className="text-[11px] text-muted-foreground/60">Source reference</label>
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
                  className="w-full px-2.5 py-1.5 rounded-lg border border-cyan-500/20 bg-background/40 text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
                />
              </div>
              <div className="w-28">
                <label className="text-[11px] text-muted-foreground/60">Poll interval</label>
                <select
                  value={syncConfig.intervalMinutes}
                  onChange={(e) => onSyncConfigChange({ ...syncConfig, intervalMinutes: Number(e.target.value) })}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-cyan-500/20 bg-background/40 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500/30"
                >
                  <option value={15}>15 min</option>
                  <option value={30}>30 min</option>
                  <option value={60}>1 hour</option>
                  <option value={360}>6 hours</option>
                  <option value={1440}>24 hours</option>
                </select>
              </div>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground/50 pl-6">
            Watches the external vault for changes and auto-updates credentials using polling.
          </p>
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={onImport}
          disabled={selectedCount === 0}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-foreground rounded-xl text-sm font-medium transition-all shadow-lg shadow-primary/20"
        >
          <Import className="w-4 h-4" />
          Import {selectedCount} Secret{selectedCount !== 1 ? 's' : ''}
        </button>
      </div>
    </motion.div>
  );
}
