import { AlertTriangle, FolderOpen, FolderPlus, RotateCcw, Search, Tag } from "lucide-react";

import { ListSkeleton } from "@/features/shared/components/layout/ListSkeleton";
import ScenarioEmptyState from "@/features/shared/components/feedback/ScenarioEmptyState";
import { useTranslation } from "@/i18n/useTranslation";
import type { DriveApi, FinderViewProps } from "../types";
import { ROW_H } from "./listGrouping";

export type FinderEmptyVariant =
  | "empty"
  | "unreadable"
  | "search-empty"
  | "recursive-empty"
  | "tagged-empty";

/**
 * Which state a view is in, in priority order: still ghosting, unreadable,
 * a local search with no hits, or a plain empty folder. `null` = render rows.
 */
export function finderEmptyVariant(
  drive: DriveApi,
  pendingCreate: unknown,
): FinderEmptyVariant | "ghost" | null {
  if (drive.loading && drive.entries.length === 0) return "ghost";
  if (drive.error) return "unreadable";
  if (drive.visibleEntries.length > 0 || pendingCreate) return null;
  return drive.searchQuery.trim().length >= 2 ? "search-empty" : "empty";
}

/**
 * Ghost rows for a cold folder. The delay lives on the placeholder
 * (docs/design/overview-loading.md law 3): invisible for the first 120ms so
 * a warm fetch never paints one.
 */
export function FinderGhost({ rows = 8, rowHeight = ROW_H }: { rows?: number; rowHeight?: number }) {
  const { t } = useTranslation();
  return (
    <div className="animate-fade-in" style={{ animationDelay: "120ms" }} data-testid="finder-ghost">
      <span className="sr-only">{t.plugins.drive.loading}</span>
      <ListSkeleton rows={rows} rowHeight={rowHeight} />
    </div>
  );
}

export function FinderEmpty({
  variant,
  drive,
  tagName,
  onRequestCreate,
}: {
  variant: FinderEmptyVariant;
  drive: DriveApi;
  /** Name of the tag whose view is empty (`tagged-empty`). */
  tagName?: string;
  /** Wired by the shell (FinderViewProps.onRequestCreate); absent → no CTA. */
  onRequestCreate?: FinderViewProps["onRequestCreate"];
}) {
  const { t, tx } = useTranslation();
  const f = t.plugins.drive.finder;
  const box = "flex-1 min-h-0 flex items-center justify-center p-8";

  if (variant === "unreadable") {
    return (
      <div className={box} data-testid="finder-empty-unreadable">
        <ScenarioEmptyState
          icon={AlertTriangle}
          iconColor="text-status-error"
          iconContainerClassName="bg-status-error/10 border-status-error/20"
          title={f.unreadable_title}
          subtitle={tx(f.unreadable_body, { error: drive.error ?? "" })}
          action={{ label: f.retry, icon: RotateCcw, onClick: () => drive.refresh() }}
        />
      </div>
    );
  }
  if (variant === "search-empty") {
    return (
      <div className={box} data-testid="finder-empty-search">
        <ScenarioEmptyState
          icon={Search}
          iconColor="text-foreground"
          iconContainerClassName="bg-secondary/40 border-primary/10"
          title={f.search_empty_title}
          subtitle={f.search_empty_body}
          action={{
            label: drive.recursiveLoading ? f.recursive_loading : f.search_all,
            icon: Search,
            onClick: () => {
              if (!drive.recursiveLoading) void drive.runRecursiveSearch();
            },
          }}
        />
      </div>
    );
  }
  if (variant === "recursive-empty") {
    return (
      <div className={box} data-testid="finder-empty-recursive">
        <ScenarioEmptyState
          icon={Search}
          iconColor="text-foreground"
          iconContainerClassName="bg-secondary/40 border-primary/10"
          title={tx(f.recursive_empty, { query: drive.recursiveQuery ?? "" })}
          action={{ label: f.recursive_clear, onClick: () => drive.clearRecursiveSearch() }}
        />
      </div>
    );
  }
  if (variant === "tagged-empty") {
    return (
      <div className={box} data-testid="finder-empty-tagged">
        <ScenarioEmptyState
          icon={Tag}
          iconColor="text-primary"
          iconContainerClassName="bg-primary/10 border-primary/20"
          title={tx(f.tagged_empty_title, { tag: tagName ?? "" })}
          subtitle={f.tagged_empty_body}
        />
      </div>
    );
  }
  return (
    <div className={box} data-testid="finder-empty-folder">
      <ScenarioEmptyState
        icon={FolderOpen}
        iconColor="text-primary"
        iconContainerClassName="bg-primary/10 border-primary/20"
        title={f.empty_folder_title}
        subtitle={f.empty_folder_body}
        action={
          onRequestCreate
            ? { label: f.empty_cta, icon: FolderPlus, onClick: () => onRequestCreate("folder") }
            : undefined
        }
      />
    </div>
  );
}
