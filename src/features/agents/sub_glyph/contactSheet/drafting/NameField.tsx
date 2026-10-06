/** NameField - the PROJECT cell's name, lettered in drafting capitals; click
 *  (or Enter on it) to rename, Enter or blur to keep, Escape to drop the edit.
 *  The same contract as Cinema's title card name. */
import { useState } from "react";
import Button from "@/features/shared/components/buttons/Button";
import { COPY } from "./copy";

export function NameField({ name, onChange }: { name: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        aria-label={COPY.rename}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { setEditing(false); if (draft.trim()) onChange(draft.trim()); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setDraft(name); setEditing(false); }
        }}
        className="w-full bg-transparent outline-none typo-heading-lg uppercase tracking-[0.08em] text-foreground"
        style={{ borderBottom: "1px dashed var(--bp-accent)" }}
      />
    );
  }
  return (
    <Button
      variant="ghost"
      size="xs"
      aria-label={`${COPY.rename}: ${name || COPY.untitled}`}
      onClick={() => { setDraft(name); setEditing(true); }}
      className="-ml-2 max-w-full justify-start"
      data-testid="drafting-project-name"
    >
      <span className="block truncate typo-heading-lg uppercase tracking-[0.08em]" style={{ color: "var(--ink-strong)" }}>
        {name || COPY.untitled}
      </span>
    </Button>
  );
}
