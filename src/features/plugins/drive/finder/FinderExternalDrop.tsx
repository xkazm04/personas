import { Upload } from "lucide-react";

import { useTranslation } from "@/i18n/useTranslation";
import { DropZoneGlow } from "@/features/shared/components/feedback/DropZoneGlow";

interface Props {
  active: boolean;
  /** Folder the drop will land in ("" = Drive root). */
  destination: string;
}

/**
 * OS-file drag overlay: the shared glow outline plus a bottom pill naming the
 * destination, which updates live as the cursor hovers folder rows / tree
 * nodes. Pointer-transparent so those targets stay reachable mid-drag.
 */
export function FinderExternalDrop({ active, destination }: Props) {
  const { t, tx } = useTranslation();
  const f = t.plugins.drive.finder;
  return (
    <>
      <DropZoneGlow active={active} radius={8} />
      {active && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-40 flex items-end justify-center pb-6"
          data-testid="finder-external-drop"
        >
          <div className="flex items-center gap-2.5 px-4 py-2 rounded-modal glass-md border border-primary/40 shadow-elevation-3">
            <Upload className="w-4 h-4 text-primary flex-shrink-0" />
            <span className="typo-body text-foreground">
              <span className="font-semibold">{f.drop_overlay_title}</span>{" "}
              {tx(f.drop_overlay_into, { path: destination || "/" })}
            </span>
          </div>
        </div>
      )}
    </>
  );
}
