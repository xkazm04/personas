import { RefreshCw, Search, Zap, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { useCredentialHealth } from '@/features/vault/shared/hooks/health/useCredentialHealth';
import { useTranslation } from '@/i18n/useTranslation';

interface TableSearchProps {
  filter: string;
  onFilterChange: (v: string) => void;
  loading: boolean;
  isRedis: boolean;
  isApi: boolean;
  onRefresh: () => void;
}

export function TableSearch({
  filter,
  onFilterChange,
  loading,
  isRedis,
  isApi,
  onRefresh,
}: TableSearchProps) {
  const { t } = useTranslation();
  const db = t.vault.databases;

  return (
    <div className="p-3 border-b border-primary/5 space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
          <input
            type="text"
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
            placeholder={isRedis ? db.filter_keys : isApi ? db.filter_databases : db.filter_tables}
            className="w-full pl-7 pr-2 py-1.5 rounded-xl bg-secondary/30 border border-primary/10 text-sm text-foreground/80 placeholder:text-muted-foreground/30 focus-visible:outline-none focus-visible:border-primary/30 transition-colors"
          />
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-foreground/70 hover:bg-secondary/40 disabled:opacity-40 transition-colors"
          title={db.refresh}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </div>
  );
}

/** Compact inline test connection for the sidebar empty state. */
export function SidebarTestConnection({ credentialId }: { credentialId: string }) {
  const { result, isHealthchecking, checkStored } = useCredentialHealth(credentialId);
  const { t } = useTranslation();
  const db = t.vault.databases;

  return (
    <div className="flex flex-col items-center gap-2 mt-2">
      <button
        onClick={checkStored}
        disabled={isHealthchecking}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/15 disabled:opacity-50 transition-colors"
      >
        {isHealthchecking ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <Zap className="w-3 h-3" />
        )}
        {isHealthchecking ? db.testing : db.test_connection}
      </button>
      {result && !isHealthchecking && (
        <div
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs ${
            result.success
              ? 'bg-emerald-500/10 text-emerald-400'
              : 'bg-red-500/10 text-red-400'
          }`}
        >
          {result.success ? (
            <CheckCircle2 className="w-3 h-3 shrink-0" />
          ) : (
            <XCircle className="w-3 h-3 shrink-0" />
          )}
          <span className="truncate max-w-[180px]">{result.message}</span>
        </div>
      )}
    </div>
  );
}
