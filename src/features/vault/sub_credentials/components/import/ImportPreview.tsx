import { ArrowLeft, AlertTriangle, Import } from 'lucide-react';
import {
  IMPORT_SOURCES,
  type ImportSourceId,
  type ImportedSecret,
  type SecretServiceMapping,
  type SyncConfig,
  groupByService,
} from './importTypes';
import { ImportSyncConfig } from './ImportSyncConfig';
import { useTranslation } from '@/i18n/useTranslation';

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
  const { t } = useTranslation();
  const source = IMPORT_SOURCES.find((s) => s.id === sourceId)!;
  const groups = groupByService(secrets, mappings);
  const selectedCount = selectedKeys.size;

  return (
    <div className="animate-fade-slide-in space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="p-1.5 rounded-card hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors"
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
          <button onClick={onSelectAll} className="text-sm text-primary hover:underline">{t.vault.import.select_all}</button>
          <span className="text-muted-foreground/40">|</span>
          <button onClick={onDeselectAll} className="text-sm text-muted-foreground hover:text-foreground hover:underline">{t.vault.import.deselect_all}</button>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="p-2.5 rounded-card border border-amber-500/20 bg-amber-500/5 text-sm text-amber-300 space-y-1">
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
            <div key={service} className="rounded-modal border border-primary/10 bg-secondary/15 overflow-hidden">
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
                        className="rounded border-primary/30 text-primary focus-visible:ring-primary/30"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-mono text-foreground truncate">{secret.key}</p>
                        {secret.sourcePath && (
                          <p className="text-[11px] text-muted-foreground/50 truncate">{secret.sourcePath}</p>
                        )}
                      </div>
                      <span className="text-sm text-muted-foreground/60 font-mono">
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
        <ImportSyncConfig
          sourceId={sourceId}
          syncConfig={syncConfig}
          onSyncConfigChange={onSyncConfigChange}
        />
      )}

      <div className="flex justify-end">
        <button
          onClick={onImport}
          disabled={selectedCount === 0}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-foreground rounded-modal text-sm font-medium transition-all shadow-elevation-3 shadow-primary/20"
        >
          <Import className="w-4 h-4" />
          Import {selectedCount} Secret{selectedCount !== 1 ? 's' : ''}
        </button>
      </div>
    </div>
  );
}
