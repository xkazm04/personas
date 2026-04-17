import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useTranslation } from '@/i18n/useTranslation';
import type { IntrospectedColumn } from '@/hooks/database/useTableIntrospection';

interface ColumnListProps {
  columns: IntrospectedColumn[];
  columnsLoading: boolean;
  columnsError: string | null;
  isApi: boolean;
  columnLabel: string;
  typeLabel: string;
}

export function ColumnList({
  columns,
  columnsLoading,
  columnsError,
  isApi,
  columnLabel,
  typeLabel,
}: ColumnListProps) {
  const { t, tx } = useTranslation();
  const db = t.vault.databases;

  if (columnsLoading) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center">
        <LoadingSpinner className="text-muted-foreground/60" />
        <span className="text-sm text-muted-foreground/60">{db.loading_columns}</span>
      </div>
    );
  }

  if (columnsError) {
    return (
      <div className="p-3 rounded-card bg-red-500/10 border border-red-500/20 text-sm text-red-400 break-words">
        {columnsError}
      </div>
    );
  }

  if (columns.length === 0) {
    return (
      <p className="text-sm text-muted-foreground/60 text-center py-8">
        {isApi ? db.no_properties : db.no_columns}
      </p>
    );
  }

  return (
    <>
      <div className="rounded-card border border-primary/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-secondary/40 border-b border-primary/10">
              <th className="px-3 py-2 text-left font-semibold text-foreground/70 w-1/3">{columnLabel}</th>
              <th className="px-3 py-2 text-left font-semibold text-foreground/70 w-1/4">{typeLabel}</th>
              {!isApi && <th className="px-3 py-2 text-center font-semibold text-foreground/70 w-20">{db.nullable}</th>}
              {!isApi && <th className="px-3 py-2 text-left font-semibold text-foreground/70">{db.default_val}</th>}
            </tr>
          </thead>
          <tbody>
            {columns.map((col, i) => (
              <tr
                key={col.column_name}
                className={`border-b border-primary/5 ${i % 2 === 0 ? 'bg-transparent' : 'bg-secondary/10'}`}
              >
                <td className="px-3 py-1.5 font-mono text-foreground/80">
                  {col.column_name}
                </td>
                <td className="px-3 py-1.5 font-mono text-blue-400/70">
                  {col.data_type}
                </td>
                {!isApi && (
                  <td className="px-3 py-1.5 text-center">
                    {col.is_nullable === 'YES' ? (
                      <span className="text-muted-foreground/60">yes</span>
                    ) : (
                      <span className="text-amber-400/70 font-medium">NOT NULL</span>
                    )}
                  </td>
                )}
                {!isApi && (
                  <td className="px-3 py-1.5 text-muted-foreground/50 truncate max-w-[200px]" title={col.column_default ?? ''}>
                    {col.column_default ?? (
                      <span className="text-muted-foreground/20">-</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-sm text-muted-foreground/60">
        {isApi
          ? tx(columns.length !== 1 ? db.property_count_other : db.property_count_one, { count: columns.length })
          : tx(columns.length !== 1 ? db.column_count_other : db.column_count_one, { count: columns.length })}
      </div>
    </>
  );
}
