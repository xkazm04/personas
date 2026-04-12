import { useCallback } from 'react';
import { Download, X, CheckCircle2, AlertTriangle } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useMediaExport } from './hooks/useMediaExport';
import type { Composition } from './types';

function formatCompDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

interface ExportPanelProps {
  composition: Composition;
}

export default function ExportPanel({ composition }: ExportPanelProps) {
  const { t } = useTranslation();
  const { exportState, startExport, cancelExport } = useMediaExport(composition);

  const handleExport = useCallback(async () => {
    const outputPath = await save({
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
      defaultPath: `${composition.name || 'export'}.mp4`,
    });
    if (!outputPath) return;
    startExport(outputPath);
  }, [composition.name, startExport]);

  const isExporting = exportState.status === 'exporting';
  const isComplete = exportState.status === 'complete';
  const isError = exportState.status === 'error';

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-t border-primary/10 bg-card/50">
      {/* Composition stats */}
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60 mr-auto tabular-nums font-mono">
        <span className="text-foreground/50">{composition.width}x{composition.height}</span>
        <span className="text-foreground/15">|</span>
        <span>{composition.fps} fps</span>
        <span className="text-foreground/15">|</span>
        <span>{composition.items.length} items</span>
        <span className="text-foreground/15">|</span>
        <span>
          {formatCompDuration(composition.items.reduce((max, it) => Math.max(max, it.startTime + it.duration), 0))}
        </span>
      </div>

      {/* Status */}
      {isExporting && (
        <div className="flex items-center gap-2">
          <LoadingSpinner size="sm" />
          <div className="w-32 h-1.5 rounded-full bg-secondary/40 overflow-hidden">
            <div
              className="h-full bg-rose-500 transition-all"
              style={{ width: `${exportState.progress * 100}%` }}
            />
          </div>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {Math.round(exportState.progress * 100)}%
          </span>
          <Button variant="ghost" size="icon-sm" onClick={cancelExport} title={t.media_studio.export_cancel}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

      {isComplete && (
        <div className="flex items-center gap-1.5 text-emerald-400">
          <CheckCircle2 className="w-4 h-4" />
          <span className="text-xs">{t.media_studio.export_complete}</span>
        </div>
      )}

      {isError && (
        <div className="flex items-center gap-1.5 text-red-400">
          <AlertTriangle className="w-4 h-4" />
          <span className="text-xs">{t.media_studio.export_failed}</span>
        </div>
      )}

      {/* Export button */}
      {!isExporting && (
        <Button
          variant="accent"
          accentColor="rose"
          size="sm"
          onClick={handleExport}
          disabled={composition.items.length === 0}
        >
          <Download className="w-3.5 h-3.5" />
          {t.media_studio.export_button}
        </Button>
      )}
    </div>
  );
}
