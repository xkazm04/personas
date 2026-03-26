import { ChevronRight } from 'lucide-react';
import type { BreadcrumbSegment, CredentialViewAction } from '@/features/vault/hooks/useCredentialViewFSM';

interface VaultBreadcrumbProps {
  segments: BreadcrumbSegment[];
  dispatch: (action: CredentialViewAction) => void;
}

/**
 * Lightweight breadcrumb strip for the credential vault.
 * Only renders when navigation depth > 1 (i.e. not on root views).
 */
export function VaultBreadcrumb({ segments, dispatch }: VaultBreadcrumbProps) {
  if (segments.length <= 1) return null;

  return (
    <nav
      aria-label="Vault breadcrumb"
      className="flex items-center gap-1 px-4 md:px-6 xl:px-8 py-1.5 text-xs text-muted-foreground/70 border-b border-primary/5 bg-secondary/10"
    >
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        return (
          <span key={i} className="flex items-center gap-1 min-w-0">
            {i > 0 && <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground/40" />}
            {seg.action && !isLast ? (
              <button
                onClick={() => dispatch(seg.action!)}
                className="hover:text-foreground/90 transition-colors truncate"
              >
                {seg.label}
              </button>
            ) : (
              <span className="text-foreground/80 font-medium truncate">{seg.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
