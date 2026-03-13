import { useEffect, useState } from 'react';
import { Package, Check, Loader2, AlertTriangle } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useSystemStore } from "@/stores/systemStore";
import { useToastStore } from '@/stores/toastStore';
import type { ExposedResource } from '@/api/network/exposure';

interface BundleExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BundleExportDialog({ isOpen, onClose }: BundleExportDialogProps) {
  const exposedResources = useSystemStore((s) => s.exposedResources);
  const fetchExposedResources = useSystemStore((s) => s.fetchExposedResources);
  const exportBundle = useSystemStore((s) => s.exportBundle);
  const addToast = useToastStore((s) => s.addToast);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen) {
      setSelected(new Set());
      setExporting(false);
      setLoading(true);
      fetchExposedResources().finally(() => setLoading(false));
    }
  }, [isOpen]);

  const toggleResource = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === exposedResources.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(exposedResources.map((r) => r.id)));
    }
  };

  const handleExport = async () => {
    if (selected.size === 0) return;

    try {
      const savePath = await save({
        defaultPath: 'personas-bundle.persona',
        filters: [{ name: 'Persona Bundle', extensions: ['persona'] }],
      });
      if (!savePath) return; // cancelled

      setExporting(true);
      const result = await exportBundle(Array.from(selected), savePath);
      addToast(`Bundle exported: ${result.resource_count} resource${result.resource_count !== 1 ? 's' : ''} (${formatBytes(result.byte_size)})`, 'success');
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[BundleExportDialog] Failed to export bundle', { selectedCount: selected.size, error: msg });
      addToast(`Failed to export bundle: ${msg}`, 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} titleId="bundle-export-title" maxWidthClass="max-w-lg">
      <div className="p-5 space-y-4">
        <div>
          <h2 id="bundle-export-title" className="text-base font-semibold text-foreground flex items-center gap-2">
            <Package className="w-4.5 h-4.5 text-cyan-400" />
            Export Bundle
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Select exposed resources to include in the signed .persona bundle.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading resources...
          </div>
        ) : exposedResources.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            <AlertTriangle className="w-5 h-5 mx-auto mb-2 text-amber-400" />
            No resources are exposed. Expose resources first in the Network settings.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <button
                onClick={toggleAll}
                className="text-xs text-primary hover:text-primary/80 transition-colors"
              >
                {selected.size === exposedResources.length ? 'Deselect all' : 'Select all'}
              </button>
              <span className="text-xs text-muted-foreground">
                {selected.size} of {exposedResources.length} selected
              </span>
            </div>

            <div className="max-h-[40vh] overflow-y-auto space-y-1.5 pr-1">
              {exposedResources.map((resource) => (
                <ResourceCheckItem
                  key={resource.id}
                  resource={resource}
                  checked={selected.has(resource.id)}
                  onToggle={() => toggleResource(resource.id)}
                />
              ))}
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-secondary/50"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={selected.size === 0 || exporting}
            className="px-3 py-1.5 text-xs rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Package className="w-3.5 h-3.5" />}
            {exporting ? 'Exporting...' : 'Export Bundle'}
          </button>
        </div>
      </div>
    </BaseModal>
  );
}

function ResourceCheckItem({
  resource,
  checked,
  onToggle,
}: {
  resource: ExposedResource;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={`w-full rounded-lg border p-2.5 flex items-center gap-2.5 text-left transition-colors ${
        checked
          ? 'border-primary/30 bg-primary/5'
          : 'border-border bg-secondary/10 hover:bg-secondary/20'
      }`}
    >
      <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
        checked ? 'bg-primary border-primary' : 'border-border'
      }`}>
        {checked && <Check className="w-3 h-3 text-white" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-foreground truncate">
          {resource.display_name || resource.resource_id}
        </div>
        <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
          <span>{resource.resource_type}</span>
          <span className="text-muted-foreground/40">·</span>
          <span>{resource.access_level}</span>
        </div>
      </div>
    </button>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
