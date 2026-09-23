/** PushPanel - the frame's inner layer, grown out of its cell.
 *
 *  Shares a `layoutId` with the frame's ghost, so framer measures the cell
 *  and animates this panel out of it (push-in) and, when the panel unmounts,
 *  the ghost back into the cell (pull-out). The body fades in after the move
 *  so text never renders mid-scale. Escape is handled by the layout. */
import { useEffect, useRef, type ReactNode } from "react";
import { motion } from "framer-motion";
import { CornerDownLeft } from "lucide-react";
import type { GlyphDimension } from "@/features/shared/glyph";
import { DIM_META } from "@/features/shared/glyph";
import Button from "@/features/shared/components/buttons/Button";
import { frameLayoutId } from "./SheetFrame";
import { COPY } from "./copy";

interface PushPanelProps {
  dim: GlyphDimension;
  number: number;
  label: string;
  asking: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function PushPanel({ dim, number, label, asking, onClose, children }: PushPanelProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const Icon = DIM_META[dim].icon;

  useEffect(() => {
    const id = window.setTimeout(() => {
      const el = bodyRef.current?.querySelector<HTMLElement>(
        "[aria-checked='true'], [autofocus], button[role='radio'], input, textarea, button",
      );
      el?.focus();
    }, 260);
    return () => window.clearTimeout(id);
  }, [dim, asking]);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-2">
      <motion.section
        layoutId={frameLayoutId(dim)}
        transition={{ layout: { duration: 0.48, ease: [0.2, 0.7, 0.2, 1] } }}
        role="region"
        aria-label={label}
        className={`pointer-events-auto flex flex-col w-full max-w-[600px] max-h-full rounded-modal border bg-background shadow-elevation-4 ${
          asking ? "border-status-warning/60" : "border-primary/30"
        }`}
        data-testid="cs-personas-push"
      >
        <header className="flex items-center gap-2.5 px-5 pt-4 pb-2">
          <span className={`typo-code ${asking ? "text-status-warning" : "text-primary"}`}>{String(number).padStart(2, "0")}</span>
          <Icon className="w-4 h-4" style={{ color: DIM_META[dim].color }} />
          <span className={`typo-label ${asking ? "text-status-warning" : "text-foreground"}`}>{label}</span>
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto"
            onClick={onClose}
            iconRight={<kbd className="typo-code text-muted px-1.5 rounded-interactive border border-card-border">{COPY.layerEsc}</kbd>}
            icon={<CornerDownLeft className="w-3.5 h-3.5" />}
          >
            {COPY.layerBack}
          </Button>
        </header>
        <motion.div
          ref={bodyRef}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.22, duration: 0.25 }}
          className="flex flex-col min-h-0 overflow-y-auto px-5 pb-5 pt-1"
        >
          {children}
        </motion.div>
      </motion.section>
    </div>
  );
}
