/** ActionPanel — the ONE surface in the centre cell that speaks about the
 *  build once it has started: the slate (state + clock) on top, the act's
 *  own content in the middle, and the act's actions along the bottom with a
 *  single primary. It is a solid card on the app's raised surface, so
 *  nothing about the build floats bare over the sheet and the sigil. */
import { Slate, type SlateProps } from "./Slate";
import { COPY } from "../copy";

interface ActionPanelProps {
  slate: SlateProps;
  children?: React.ReactNode;
  /** Primary first, then the secondary actions. */
  actions?: React.ReactNode;
  /** One quiet line at the end of the actions row. */
  hint?: string;
}

export function ActionPanel({ slate, children, actions, hint }: ActionPanelProps) {
  return (
    <section
      aria-label={COPY.panel}
      data-testid="sheet-cinema-action-panel"
      className="w-full max-w-[480px] flex-shrink-0 rounded-card border border-card-border bg-secondary shadow-elevation-2 overflow-hidden text-left"
    >
      <Slate {...slate} />
      {children && <div className="px-4 pb-3 flex flex-col gap-2 min-w-0">{children}</div>}
      {(actions || hint) && (
        <div className="px-3 py-2.5 border-t border-card-border flex flex-wrap items-center gap-1.5">
          {actions}
          {hint && <span className="ml-auto typo-caption text-foreground">{hint}</span>}
        </div>
      )}
    </section>
  );
}
