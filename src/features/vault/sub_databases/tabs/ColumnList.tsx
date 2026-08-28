import { useTranslation } from '@/i18n/useTranslation';
import type { IntrospectedColumn } from '@/hooks/database/useTableIntrospection';

/** Deterministic width variety so the ghosts read as rows, not a barcode. */
const GHOST_BAR_WIDTHS = ['w-3/5', 'w-2/5', 'w-1/2', 'w-1/3'];

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

  // Loading pattern v2, law 3: the permanent chrome (the column table's own
  // header) renders, and the ghost goes UNDER it — so selecting a table paints
  // the shape of the answer immediately instead of the `null` that
  // `feedback/LoadingSpinner` used to render beside the "Loading columns..."
  // label. Geometry-matched to the real `px-3 py-1.5` rows below.
  if (columnsLoading) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{db.loading_columns}</span>
        <div className="rounded-card border border-primary/10 overflow-hidden" aria-hidden="true">
          <table className="w-full typo-body">
            <thead>
              <tr className="bg-secondary/40 border-b border-primary/10">
                <th className="px-3 py-2 text-left font-semibold text-foreground w-1/3">{columnLabel}</th>
                <th className="px-3 py-2 text-left font-semibold text-foreground w-1/4">{typeLabel}</th>
                {!isApi && <th className="px-3 py-2 text-center font-semibold text-foreground w-20">{db.nullable}</th>}
                {!isApi && <th className="px-3 py-2 text-left font-semibold text-foreground">{db.default_val}</th>}
              </tr>
            </thead>
            <tbody>
              {GHOST_BAR_WIDTHS.concat(GHOST_BAR_WIDTHS).map((w, r) => (
                <tr
                  key={r}
                  className={`border-b border-primary/5 animate-fade-in ${r % 2 === 0 ? 'bg-transparent' : 'bg-secondary/10'}`}
                  style={{ animationDelay: `${120 + r * 35}ms` }}
                >
                  <td className="px-3 py-1.5">
                    <span className={`inline-block h-3 rounded bg-primary/[0.06] ${w}`} />
                  </td>
                  <td className="px-3 py-1.5">
                    <span className="inline-block h-3 w-2/5 rounded bg-primary/[0.06]" />
                  </td>
                  {!isApi && (
                    <td className="px-3 py-1.5 text-center">
                      <span className="inline-block h-3 w-6 rounded bg-primary/[0.06]" />
                    </td>
                  )}
                  {!isApi && (
                    <td className="px-3 py-1.5">
                      <span className="inline-block h-3 w-1/3 rounded bg-primary/[0.06]" />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (columnsError) {
    return (
      <div className="p-3 rounded-card bg-red-500/10 border border-red-500/20 typo-body text-red-400 break-words">
        {columnsError}
      </div>
    );
  }

  if (columns.length === 0) {
    return (
      <p className="typo-body text-foreground text-center py-8">
        {isApi ? db.no_properties : db.no_columns}
      </p>
    );
  }

  return (
    <>
      <div className="rounded-card border border-primary/10 overflow-hidden">
        <table className="w-full typo-body">
          <thead>
            <tr className="bg-secondary/40 border-b border-primary/10">
              <th className="px-3 py-2 text-left font-semibold text-foreground w-1/3">{columnLabel}</th>
              <th className="px-3 py-2 text-left font-semibold text-foreground w-1/4">{typeLabel}</th>
              {!isApi && <th className="px-3 py-2 text-center font-semibold text-foreground w-20">{db.nullable}</th>}
              {!isApi && <th className="px-3 py-2 text-left font-semibold text-foreground">{db.default_val}</th>}
            </tr>
          </thead>
          <tbody>
            {columns.map((col, i) => (
              <tr
                key={col.column_name}
                className={`border-b border-primary/5 ${i % 2 === 0 ? 'bg-transparent' : 'bg-secondary/10'}`}
              >
                <td className="px-3 py-1.5 font-mono text-foreground">
                  {col.column_name}
                </td>
                <td className="px-3 py-1.5 font-mono text-blue-400/70">
                  {col.data_type}
                </td>
                {!isApi && (
                  <td className="px-3 py-1.5 text-center">
                    {col.is_nullable === 'YES' ? (
                      <span className="text-foreground">{db.column_nullable_yes}</span>
                    ) : (
                      <span className="text-amber-400/70 font-medium">{db.not_null}</span>
                    )}
                  </td>
                )}
                {!isApi && (
                  <td className="px-3 py-1.5 text-foreground truncate max-w-[200px]" title={col.column_default ?? ''}>
                    {col.column_default ?? (
                      <span className="text-foreground">-</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 typo-body text-foreground">
        {isApi
          ? tx(columns.length !== 1 ? db.property_count_other : db.property_count_one, { count: columns.length })
          : tx(columns.length !== 1 ? db.column_count_other : db.column_count_one, { count: columns.length })}
      </div>
    </>
  );
}
