import { useEffect, useRef, useState } from "react";

/**
 * Inline rename / create input. Focuses on mount and pre-selects the base
 * name (everything before the last dot) so the extension survives a retype.
 * Enter commits, Esc cancels, blur cancels; key events stop at the input so
 * the shell's global shortcuts never see them.
 */
export function InlineNameInput({
  initialName,
  onCommit,
  onCancel,
  className = "",
}: {
  initialName: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const [value, setValue] = useState(initialName);
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = initialName.lastIndexOf(".");
    if (dot > 0) el.setSelectionRange(0, dot);
    else el.select();
  }, [initialName]);

  return (
    <input
      ref={ref}
      type="text"
      value={value}
      spellCheck={false}
      autoComplete="off"
      data-testid="finder-inline-name"
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit(value.trim());
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onBlur={onCancel}
      className={`min-w-0 px-1.5 py-0.5 rounded-input bg-background border border-primary/40 typo-body text-foreground focus-ring ${className}`}
    />
  );
}
