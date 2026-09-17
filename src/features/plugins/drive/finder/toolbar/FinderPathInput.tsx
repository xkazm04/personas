import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";

import { useTranslation } from "@/i18n/useTranslation";

import type { DriveApi } from "../types";

/** Path normaliser: relative, no leading/trailing slashes, no `//`. */
export function normalizePathInput(raw: string): string {
  return raw
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");
}

interface Props {
  drive: DriveApi;
  onDone: () => void;
}

/**
 * The breadcrumb's edit mode (Mod+L / pencil): a path input pre-filled with
 * the current path. Enter navigates, Esc and blur cancel.
 */
export function FinderPathInput({ drive, onDone }: Props) {
  const { t } = useTranslation();
  const f = t.plugins.drive.finder;
  const [draft, setDraft] = useState(drive.currentPath);
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Defer until the swap has painted so focus + select land on the input.
    const id = requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className="flex items-center gap-2 min-w-0 flex-1 px-2 py-0.5 rounded-card bg-primary/10 border border-primary/40 focus-within:ring-2 focus-within:ring-primary/20">
      <Pencil className="w-3.5 h-3.5 text-primary flex-shrink-0" aria-hidden />
      <input
        ref={ref}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            drive.navigate(normalizePathInput(draft));
            onDone();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onDone();
          }
        }}
        onBlur={onDone}
        placeholder={f.path_placeholder}
        aria-label={f.path_edit}
        spellCheck={false}
        autoComplete="off"
        className="flex-1 min-w-0 bg-transparent typo-body font-mono text-foreground placeholder:text-foreground/60 focus:outline-none"
        data-testid="finder-path-input"
      />
      <span className="typo-caption text-foreground flex-shrink-0 hidden md:inline">{f.path_hint}</span>
    </div>
  );
}
