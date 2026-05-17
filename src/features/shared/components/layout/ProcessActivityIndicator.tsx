import { useState } from "react";
import { ActivityPulseIcon } from "@/features/shared/components/icons/ActivityPulseIcon";
import { useOverviewStore } from "@/stores/overviewStore";
import ProcessActivityDrawer from "./ProcessActivityDrawer";

export default function ProcessActivityIndicator() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Subscribe to the primitive count, maintained in sync with activeProcesses
  // by the slice. Previously this read `Object.keys(activeProcesses).length`
  // inside a useShallow selector that re-ran on every store mutation —
  // including telemetry ticks (enrichProcess) that don't change the count.
  // With Object.is equality on a number, the indicator now re-renders only
  // when the count actually transitions.
  let count = 0;
  try {
    count = useOverviewStore((s) => s.activeProcessCount);
  } catch {
    // Store broken — render icon with no badge
  }

  const isActive = count > 0;

  return (
    <>
      <button
        className="titlebar-btn relative"
        data-testid="titlebar-process-activity"
        onClick={() => setDrawerOpen((v) => !v)}
        aria-label={`Process activity${count > 0 ? ` (${count} active)` : ""}`}
        title={count > 0 ? `${count} active process${count !== 1 ? "es" : ""}` : "Process activity"}
      >
        <ActivityPulseIcon
          width={22}
          height={22}
          strokeWidth={1.5}
          className={isActive ? "text-primary" : "text-foreground"}
        />
        {count > 0 && (
          <span className="absolute top-2 right-1.5 min-w-[16px] h-[16px] px-[3px] flex items-center justify-center text-[9px] font-bold leading-none rounded-full bg-primary/20 text-primary shadow-elevation-1">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>
      {drawerOpen && <ProcessActivityDrawer onClose={() => setDrawerOpen(false)} />}
    </>
  );
}
