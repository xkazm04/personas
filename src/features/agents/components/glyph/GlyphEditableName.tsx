import { useState, useEffect } from "react";
import { Pencil } from "lucide-react";
import { debtText } from '@/i18n/DebtText';


interface GlyphEditableNameProps {
  value: string;
  onChange: (v: string) => void;
  editable: boolean;
}

export function GlyphEditableName({ value, onChange, editable }: GlyphEditableNameProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  if (!editable) {
    return (
      <span className="typo-label font-bold uppercase tracking-[0.3em] text-foreground">
        {value || "Describe Your Agent"}
      </span>
    );
  }
  if (editing) {
    return (
      <input
        type="text"
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { onChange(draft.trim() || value); setEditing(false); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { onChange(draft.trim() || value); setEditing(false); }
          if (e.key === "Escape") { setDraft(value); setEditing(false); }
        }}
        className="typo-heading-sm font-bold text-foreground bg-transparent border-b border-primary/40 focus:outline-none text-center min-w-[160px]"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="group inline-flex items-center gap-1.5 typo-heading-sm font-bold text-foreground hover:text-primary transition-colors"
      title={debtText("auto_rename_agent_90f3a81d")}
    >
      <span>{value || "Untitled agent"}</span>
      <Pencil className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
}
