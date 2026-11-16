import { ArrowLeft, AlertTriangle, Import } from 'lucide-react';
import {
  IMPORT_SOURCES,
  type ImportSourceId,
  type ImportedSecret,
  type SecretServiceMapping,
  type SyncConfig,
  groupByService,
} from './importHelpers';
import { ImportSyncConfig } from './ImportSyncConfig';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';

interface ImportPreviewProps {
  sourceId: ImportSourceId;
  secrets: ImportedSecret[];
  mappings: SecretServiceMapping[];
  selectedKeys: Set<string>;
  errors: string[];
  syncConfig: SyncConfig | null;
  onToggleKey: (id: string) => void;
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
  const { t, tx } = useTranslation();
  const vi = t.vault.import;
  const source = IMPORT_SOURCES.find((s) => s.id === sourceId)!;
  const groups = groupByService(secrets, mappings);
  const selectedCount = selectedKeys.size;

  return (
    <div className="animate-fade-slide-in space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={onBack}
            variant="ghost"
            size="icon-sm"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h3 className="typo-body text-foreground">
              {tx(secrets.length !== 1 ? vi.secrets_found_other : vi.secrets_found_one, { count: secrets.length })}
            </h3>
            <p className="typo-body text-foreground">
              {selectedCount} {vi.selected_for_import}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" onClick={onSelectAll} variant="ghost" size="sm">{vi.select_all}</Button>
          <span className="text-foreground">|</span>
          <Button type="button" onClick={onDeselectAll} variant="ghost" size="sm">{vi.deselect_all}</Button>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="p-2.5 rounded-card border border-status-warning/20 bg-status-warning/5 typo-body text-status-warning space-y-1">
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
            <div key={service} className="rounded-modal border border-hair bg-secondary/15 overflow-hidden">
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
                <span className="typo-body text-foreground">{service}</span>
                {mapping?.confidence === 'high' && (
                  <span className="typo-caption px-1.5 py-0.5 text-status-success">
                    {vi.auto_detected}
                  </span>
                )}
              </div>
              <div className="divide-y divide-primary/5">
                {groupSecrets.map((secret) => {
                  const isSelected = selectedKeys.has(secret.id);
                  return (
                    <label
                      key={secret.id}
                      className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-surface-1 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleKey(secret.id)}
                        className="rounded-interactive border-primary/30 text-primary focus-visible:ring-primary/30"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="typo-code text-foreground truncate">{secret.key}</p>
                        {secret.sourcePath && (
                          <p className="typo-caption text-foreground truncate">{secret.sourcePath}</p>
                        )}
                      </div>
                      <span className="typo-code text-foreground">
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
        <Button
          type="button"
          onClick={onImport}
          disabled={selectedCount === 0}
          variant="primary"
          size="md"
          icon={<Import className="w-4 h-4" />}
        >
          {tx(selectedCount !== 1 ? vi.import_secrets_other : vi.import_secrets_one, { count: selectedCount })}
        </Button>
      </div>
    </div>
  );
}
