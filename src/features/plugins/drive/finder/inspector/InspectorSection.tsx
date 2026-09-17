import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

import { Collapse } from "@/features/shared/components/display/Collapse";

interface Props {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Optional trailing element in the header row (a badge, a count). */
  trailing?: ReactNode;
  testId?: string;
}

/** One collapsible Inspector block: a `typo-label` header button over `Collapse`. */
export function InspectorSection({ title, children, defaultOpen = true, trailing, testId }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section data-testid={testId} className="border-b border-card-border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-secondary/30 transition-colors focus-ring"
      >
        <ChevronDown
          className={`w-3.5 h-3.5 text-foreground transition-transform motion-reduce:transition-none ${open ? "" : "-rotate-90"}`}
        />
        <span className="typo-label text-foreground flex-1 truncate">{title}</span>
        {trailing}
      </button>
      <Collapse open={open}>
        <div className="px-4 pb-3">{children}</div>
      </Collapse>
    </section>
  );
}
