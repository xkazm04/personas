import { Monitor, CheckCircle2 } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { ImportedMcpServer } from '@/api/system/desktop';

interface McpServerCardProps {
  server: ImportedMcpServer;
  imported: boolean;
  importing: boolean;
  onImport: () => void;
}

export function McpServerCard({ server, imported, importing, onImport }: McpServerCardProps) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border border-primary/10 bg-secondary/20">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center border bg-cyan-500/10 border-cyan-500/20">
        <Monitor className="w-4 h-4 text-cyan-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{server.label}</p>
        <p className="text-xs text-muted-foreground/60 truncate font-mono">{server.command}</p>
        {Object.keys(server.env).length > 0 && (
          <p className="text-xs text-muted-foreground/60">
            {Object.keys(server.env).length} env var{Object.keys(server.env).length !== 1 ? 's' : ''}
          </p>
        )}
      </div>
      {imported ? (
        <span className="flex items-center gap-1 text-xs text-emerald-400">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Imported
        </span>
      ) : (
        <button
          onClick={onImport}
          disabled={importing}
          className="px-3 py-1.5 text-xs font-medium text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 rounded-lg hover:bg-cyan-500/20 transition-colors disabled:opacity-50"
        >
          {importing ? (
            <LoadingSpinner size="sm" />
          ) : (
            'Import'
          )}
        </button>
      )}
    </div>
  );
}
