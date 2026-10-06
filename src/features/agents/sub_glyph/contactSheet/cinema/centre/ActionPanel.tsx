/** ActionPanel — the ONE surface in the centre cell that speaks about the
 *  build once it has started: the slate (state + clock) on top, the act's
 *  own content in the middle, and the act's actions along the bottom with a
 *  single primary. In Cinema it is a solid card on the app's raised surface,
 *  so nothing about the build floats bare over the sheet and the sigil. In a
 *  drafting layout (usePanelLook) it is a drafted title block instead: a
 *  hairline frame in the drawing's ink with registration ticks at its
 *  corners, the stage showing faintly through, and a tighter rhythm so the
 *  whole act fits the dial's hub without scrolling. */
import { Slate, type SlateProps } from "./Slate";
import { usePanelLook } from "./panelLook";
import { COPY } from "../copy";

interface ActionPanelProps {
  slate: SlateProps;
  children?: React.ReactNode;
  /** Primary first, then the secondary actions. */
  actions?: React.ReactNode;
  /** One quiet line at the end of the actions row. */
  hint?: string;
  /** A build error line under the slate, so an error never lands as a banner
   *  outside the sheet (which would shrink the stage under it). */
  alert?: string | null;
}

/** Registration ticks at a drafted frame's four corners. */
function CornerTicks() {
  const tick = "absolute w-2.5 h-2.5 pointer-events-none";
  const ink = "1.5px solid var(--ink, var(--foreground))";
  return (
    <>
      <span aria-hidden className={`${tick} -left-px -top-px`} style={{ borderLeft: ink, borderTop: ink }} />
      <span aria-hidden className={`${tick} -right-px -top-px`} style={{ borderRight: ink, borderTop: ink }} />
      <span aria-hidden className={`${tick} -left-px -bottom-px`} style={{ borderLeft: ink, borderBottom: ink }} />
      <span aria-hidden className={`${tick} -right-px -bottom-px`} style={{ borderRight: ink, borderBottom: ink }} />
    </>
  );
}

export function ActionPanel({ slate, children, actions, hint, alert }: ActionPanelProps) {
  const drafting = usePanelLook() === "drafting";
  return (
    <section
      aria-label={COPY.panel}
      data-testid="sheet-cinema-action-panel"
      className={drafting
        ? "relative w-full max-w-[480px] flex-shrink-0 text-left"
        : "w-full max-w-[480px] flex-shrink-0 rounded-card border border-card-border bg-secondary shadow-elevation-2 overflow-hidden text-left"}
      style={drafting ? { border: "1px solid var(--ink-dim)", background: "color-mix(in srgb, var(--background) 84%, transparent)" } : undefined}
    >
      {drafting && <CornerTicks />}
      <Slate {...slate} />
      {alert && (
        <p role="alert" className={`${drafting ? "px-3 pb-1.5" : "px-4 pb-2"} typo-body text-status-error line-clamp-3 break-words`} data-testid="sheet-cinema-panel-alert">
          {alert}
        </p>
      )}
      {children && <div className={drafting ? "px-3 pt-2 pb-2 flex flex-col gap-1.5 min-w-0" : "px-4 pb-3 flex flex-col gap-2 min-w-0"}>{children}</div>}
      {(actions || hint) && (
        <div
          className={`${drafting ? "px-2.5 py-2" : "px-3 py-2.5 border-t border-card-border"} flex flex-wrap items-center gap-1.5`}
          style={drafting ? { borderTop: "1px dashed var(--ink-faint)" } : undefined}
        >
          {actions}
          {hint && <span className="ml-auto typo-caption text-foreground">{hint}</span>}
        </div>
      )}
    </section>
  );
}
