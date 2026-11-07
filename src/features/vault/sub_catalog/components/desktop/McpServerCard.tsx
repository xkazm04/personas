import { Monitor, CheckCircle2 } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { ImportedMcpServer } from '@/api/system/desktop';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';

interface McpServerCardProps {
  server: ImportedMcpServer;
  imported: boolean;
  importing: boolean;
  onImport: () => void;
}

export function McpServerCard({ server, imported, importing, onImport }: McpServerCardProps) {
  const { t, tx } = useTranslation();
  const dd = t.vault.desktop_discovery;
  const envCount = Object.keys(server.env).length;
  return (
    <div className="flex items-center gap-3 p-3 rounded-modal border border-hair bg-surface-1">
      <div className="w-8 h-8 rounded-card flex items-center justify-center border bg-role-highlight/10 border-role-highlight/20">
        <Monitor className="w-4 h-4 text-role-highlight" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="typo-body text-foreground">{server.label}</p>
        <p className="typo-code text-foreground truncate">{server.command}</p>
        {envCount > 0 && (
          <p className="typo-caption text-foreground">
            {tx(envCount === 1 ? dd.env_var_one : dd.env_var_other, { count: envCount })}
          </p>
        )}
      </div>
      {imported ? (
        <span className="flex items-center gap-1 typo-caption text-status-success">
          <CheckCircle2 className="w-3.5 h-3.5" />
          {t.common.imported}
        </span>
      ) : (
        <Button
          type="button"
          onClick={onImport}
          disabled={importing}
          variant="accent"
          tone="highlight"
          size="sm"
        >
          {importing ? (
            <LoadingSpinner size="sm" />
          ) : (
            t.common.import_action
          )}
        </Button>
      )}
    </div>
  );
}
