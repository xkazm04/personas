import { ChevronLeft, ChevronRight } from 'lucide-react';

interface TemplatePaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function TemplatePagination({ page, totalPages, onPageChange }: TemplatePaginationProps) {
  if (totalPages <= 1) return null;

  // Generate page numbers with ellipsis
  const getPageNumbers = (): (number | '...')[] => {
    const pages: (number | '...')[] = [];
    const maxVisible = 7;

    if (totalPages <= maxVisible) {
      for (let i = 0; i < totalPages; i++) pages.push(i);
      return pages;
    }

    // Always show first page
    pages.push(0);

    if (page > 2) {
      pages.push('...');
    }

    // Pages around current
    const start = Math.max(1, page - 1);
    const end = Math.min(totalPages - 2, page + 1);

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }

    if (page < totalPages - 3) {
      pages.push('...');
    }

    // Always show last page
    pages.push(totalPages - 1);

    return pages;
  };

  return (
    <div className="px-4 py-3.5 border-t border-primary/10 flex items-center justify-center gap-1.5">
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page === 0}
        className="p-2 rounded-lg text-muted-foreground/70 hover:bg-secondary/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronLeft className="w-4.5 h-4.5" />
      </button>

      {getPageNumbers().map((p, i) =>
        p === '...' ? (
          <span key={`ellipsis-${i}`} className="px-2.5 text-sm text-muted-foreground/40">
            ...
          </span>
        ) : (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            className={`min-w-[32px] h-8 rounded-lg text-sm font-medium transition-colors ${
              p === page
                ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                : 'text-muted-foreground/70 hover:bg-secondary/50'
            }`}
          >
            {p + 1}
          </button>
        ),
      )}

      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages - 1}
        className="p-2 rounded-lg text-muted-foreground/70 hover:bg-secondary/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronRight className="w-4.5 h-4.5" />
      </button>
    </div>
  );
}
