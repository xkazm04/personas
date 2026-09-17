import { useId, useState } from "react";
import { Plus } from "lucide-react";

import type { DriveTag } from "@/api/drive";
import { useTranslation } from "@/i18n/useTranslation";
import { tagColorClass } from "../tagColor";

interface Props {
  /** Named (non-builtin) tags not yet applied to the selection. */
  candidates: DriveTag[];
  onAdd: (tagId: string) => void;
  onCreate: (name: string) => void;
  disabled?: boolean;
}

/**
 * "Add tag" — a filtered input over the vocabulary. Typing narrows the
 * list; a name that matches nothing offers "Create tag ‘x’". Arrow keys
 * move the highlight, Enter picks, Escape closes.
 */
export function TagAddCombobox({ candidates, onAdd, onCreate, disabled = false }: Props) {
  const { t } = useTranslation();
  const f = t.plugins.drive.finder;
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const q = query.trim().toLowerCase();
  const matches = q ? candidates.filter((c) => c.name.toLowerCase().includes(q)) : candidates;
  const exact = candidates.some((c) => c.name.toLowerCase() === q);
  const canCreate = q.length > 0 && !exact;
  const options: Array<{ key: string; label: string; tag?: DriveTag }> = [
    ...matches.map((tag) => ({ key: tag.id, label: tag.name, tag })),
    ...(canCreate ? [{ key: "__create", label: `${f.tag_create}: ${query.trim()}` }] : []),
  ];
  const active = Math.min(highlight, Math.max(0, options.length - 1));

  const pick = (i: number) => {
    const opt = options[i];
    if (!opt) return;
    if (opt.tag) onAdd(opt.tag.id);
    else onCreate(query.trim());
    setQuery("");
    setOpen(false);
    setHighlight(0);
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-1.5 rounded-input border border-card-border bg-card-bg px-2 focus-within:border-primary/40">
        <Plus className="w-3.5 h-3.5 text-foreground flex-shrink-0" />
        <input
          type="text"
          role="combobox"
          aria-label={f.tag_add}
          aria-expanded={open && options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          placeholder={f.tag_add}
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setHighlight((h) => Math.min(h + 1, options.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(active);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          className="flex-1 min-w-0 bg-transparent py-1.5 typo-body text-foreground placeholder:text-foreground/60 outline-none"
        />
      </div>
      {open && options.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1 z-20 max-h-48 overflow-y-auto rounded-card border border-card-border bg-background shadow-elevation-3 py-1"
        >
          {options.map((opt, i) => (
            <li
              key={opt.key}
              role="option"
              aria-selected={i === active}
              // mousedown so the input's blur does not close the list first.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(i);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={`flex items-center gap-2 px-2.5 py-1.5 typo-body text-foreground cursor-pointer ${
                i === active ? "bg-primary/15" : ""
              }`}
            >
              {opt.tag ? (
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${tagColorClass(opt.tag.color)}`} />
              ) : (
                <Plus className="w-3 h-3 flex-shrink-0 text-primary" />
              )}
              <span className="truncate">
                {opt.tag ? opt.label : f.tag_create}
                {!opt.tag && <span className="text-primary"> ‘{query.trim()}’</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
