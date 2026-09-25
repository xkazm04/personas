/**
 * DataGrid's pager: page-size choice, the item range, and page buttons. Chrome,
 * so it stays quiet: one mono size (`typo-code`, the floor), the shared
 * ThemedSelect and Button, token radii. Internal to DataGrid (not catalogued).
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { useTranslation } from '@/i18n/useTranslation';

export interface DataGridPagerProps {
  page: number;
  totalPages: number;
  pageSize: number;
  pageSizeOptions: number[];
  total: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}

/** The five page numbers around the current one. */
function pageWindow(page: number, totalPages: number): number[] {
  return Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
    if (totalPages <= 5 || page <= 3) return i + 1;
    if (page >= totalPages - 2) return totalPages - 4 + i;
    return page - 2 + i;
  });
}

export function DataGridPager({ page, totalPages, pageSize, pageSizeOptions, total, onPage, onPageSize }: DataGridPagerProps) {
  const { t } = useTranslation();
  const start = Math.min((page - 1) * pageSize + 1, total);
  const end = Math.min(page * pageSize, total);
  // A caller's page size that is not among the options (LiveStream passes 20)
  // is still the size in use: list it, or the trigger would name no size at all.
  const sizes = pageSizeOptions.includes(pageSize)
    ? pageSizeOptions
    : [...pageSizeOptions, pageSize].sort((x, y) => x - y);
  return (
    <div className="flex items-center justify-between px-4 py-2 border-t border-primary/10 bg-background/60 shrink-0">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="typo-code text-foreground">{t.shared.grid_rows}</span>
          <span data-testid="page-size-select">
            <ThemedSelect
              filterable
              hideSearch
              options={sizes.map((opt) => ({ value: String(opt), label: String(opt) }))}
              value={String(pageSize)}
              onValueChange={(v) => onPageSize(Number(v))}
              aria-label={t.shared.grid_rows_per_page}
              wrapperClassName="w-16"
              // Chrome-sized trigger: the select's own padding and radius give way
              // to the pager's (the same override the filterable header uses).
              className="!px-2 !py-0.5 !pr-7 !rounded-interactive !border-primary/10 !bg-secondary/30 hover:!bg-secondary/50 typo-code"
            />
          </span>
        </div>
        <span className="typo-code text-foreground whitespace-nowrap">
          {t.shared.grid_showing
            .replace('{start}', String(start))
            .replace('{end}', String(end))
            .replace('{total}', String(total))}
        </span>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          {pageWindow(page, totalPages).map((p) => (
            <Button
              key={p}
              variant={p === page ? 'accent' : 'ghost'}
              size="icon-sm"
              onClick={() => onPage(p)}
              aria-current={p === page ? 'page' : undefined}
              className={`typo-code ${p === page ? 'bg-primary/10 border-primary/20' : ''}`}
            >
              {p}
            </Button>
          ))}
          <Button variant="ghost" size="icon-sm" onClick={() => onPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
