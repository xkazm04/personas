import type { ComponentProps } from "react";
import { AlertTriangle, FolderOpen, FolderPlus, RotateCcw, Search, Tag } from "lucide-react";

import type ScenarioEmptyState from "@/features/shared/components/feedback/ScenarioEmptyState";
import type { useTranslation } from "@/i18n/useTranslation";
import type { DriveApi, FinderViewProps } from "../types";

export type FinderEmptyVariant =
  | "empty"
  | "unreadable"
  | "search-empty"
  | "recursive-empty"
  | "tagged-empty";

export type FinderScenarioProps = ComponentProps<typeof ScenarioEmptyState>;

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

/** The box every Finder scenario sits in: fills the view and centres the state. */
export const FINDER_SCENARIO_BOX = "flex-1 min-h-0 flex items-center justify-center p-8";

const TEST_ID: Record<FinderEmptyVariant, string> = {
  empty: "finder-empty-folder",
  unreadable: "finder-empty-unreadable",
  "search-empty": "finder-empty-search",
  "recursive-empty": "finder-empty-recursive",
  "tagged-empty": "finder-empty-tagged",
};

export function finderScenarioTestId(variant: FinderEmptyVariant): string {
  return TEST_ID[variant];
}

export interface FinderScenarioArgs extends Pick<ReturnType<typeof useTranslation>, "t" | "tx"> {
  drive: DriveApi;
  /** Name of the tag whose view is empty (`tagged-empty`). */
  tagName?: string;
  /** Wired by the shell (FinderViewProps.onRequestCreate); absent → no CTA. */
  onRequestCreate?: FinderViewProps["onRequestCreate"];
  /** `unreadable` over a derived list: the failure and its retry, instead of the drive's. */
  error?: string | null;
  onRetry?: () => void;
}

/**
 * Props for the shared `ScenarioEmptyState`, one condition per Finder
 * variant. A pure builder rather than a component: the surface selects a
 * condition on the shared primitive instead of authoring its own empty state
 * (docs/concepts/golden-paths/empty-and-demo-states.md).
 */
export function finderScenario(variant: FinderEmptyVariant, args: FinderScenarioArgs): FinderScenarioProps {
  const { t, tx, drive } = args;
  const f = t.plugins.drive.finder;
  switch (variant) {
    case "unreadable":
      return {
        icon: AlertTriangle,
        iconColor: "text-status-error",
        iconContainerClassName: "bg-status-error/10 border-status-error/20",
        title: f.unreadable_title,
        subtitle: tx(f.unreadable_body, { error: args.error ?? drive.error ?? "" }),
        action: { label: f.retry, icon: RotateCcw, onClick: args.onRetry ?? (() => drive.refresh()) },
      };
    case "search-empty":
      return {
        icon: Search,
        iconColor: "text-foreground",
        iconContainerClassName: "bg-secondary/40 border-primary/10",
        title: f.search_empty_title,
        subtitle: f.search_empty_body,
        action: {
          label: drive.recursiveLoading ? f.recursive_loading : f.search_all,
          icon: Search,
          onClick: () => {
            if (!drive.recursiveLoading) void drive.runRecursiveSearch();
          },
        },
      };
    case "recursive-empty":
      return {
        icon: Search,
        iconColor: "text-foreground",
        iconContainerClassName: "bg-secondary/40 border-primary/10",
        title: tx(f.recursive_empty, { query: drive.recursiveQuery ?? "" }),
        action: { label: f.recursive_clear, onClick: () => drive.clearRecursiveSearch() },
      };
    case "tagged-empty":
      return {
        icon: Tag,
        iconColor: "text-primary",
        iconContainerClassName: "bg-primary/10 border-primary/20",
        title: tx(f.tagged_empty_title, { tag: args.tagName ?? "" }),
        subtitle: f.tagged_empty_body,
      };
    default: {
      const { onRequestCreate } = args;
      return {
        icon: FolderOpen,
        iconColor: "text-primary",
        iconContainerClassName: "bg-primary/10 border-primary/20",
        title: f.empty_folder_title,
        subtitle: f.empty_folder_body,
        action: onRequestCreate
          ? { label: f.empty_cta, icon: FolderPlus, onClick: () => onRequestCreate("folder") }
          : undefined,
      };
    }
  }
}
