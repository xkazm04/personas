import type { RefObject } from "react";
import { Search, X } from "lucide-react";

import { useTranslation } from "@/i18n/useTranslation";
import Button from "@/features/shared/components/buttons/Button";

import type { DriveApi } from "../types";

interface Props {
  drive: DriveApi;
  inputRef: RefObject<HTMLInputElement | null>;
}

/**
 * Per-folder filter with escalation: when the local filter finds
 * nothing, a "Search all of Drive" button runs the recursive backend walk.
 * The results themselves render in the main column (FinderDerivedList).
 */
export function FinderSearch({ drive, inputRef }: Props) {
  const { t } = useTranslation();
  const f = t.plugins.drive.finder;
  const query = drive.searchQuery;
  const canEscalate =
    query.trim().length >= 2 && drive.visibleEntries.length === 0 && drive.recursiveResults === null;

  return (
    <div className="flex items-center gap-1">
      <div className="relative flex items-center group">
        <Search
          className="absolute left-2.5 w-3.5 h-3.5 text-foreground pointer-events-none group-focus-within:text-primary"
          aria-hidden
        />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => drive.setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              drive.setSearchQuery("");
              e.currentTarget.blur();
            } else if (e.key === "Enter" && canEscalate) {
              e.preventDefault();
              void drive.runRecursiveSearch();
            }
          }}
          placeholder={f.search_placeholder}
          aria-label={f.search_placeholder}
          spellCheck={false}
          autoComplete="off"
          className="pl-8 pr-7 py-1 w-52 rounded-input bg-secondary/30 border border-border typo-body text-foreground placeholder:text-foreground/60 focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-colors duration-fast [&::-webkit-search-cancel-button]:hidden"
          data-testid="finder-search"
        />
        {query && (
          <span className="absolute right-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={f.search_clear}
              title={f.search_clear}
              onClick={() => drive.setSearchQuery("")}
            >
              <X className="w-3 h-3" />
            </Button>
          </span>
        )}
      </div>
      {canEscalate && (
        <Button
          variant="primary"
          size="xs"
          loading={drive.recursiveLoading}
          loadingLabel={f.recursive_loading}
          onClick={() => void drive.runRecursiveSearch()}
        >
          {f.search_all}
        </Button>
      )}
    </div>
  );
}
