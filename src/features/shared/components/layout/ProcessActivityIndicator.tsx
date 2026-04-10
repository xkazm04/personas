import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ActivityPulseIcon } from "@/features/shared/components/icons/ActivityPulseIcon";
import { useOverviewStore } from "@/stores/overviewStore";
import ProcessActivityDrawer from "./ProcessActivityDrawer";

export default function ProcessActivityIndicator() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  let count = 0;
  try {
    count = useOverviewStore(
      useShallow((s) => Object.keys(s.activeProcesses).length),
    );
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
          className={isActive ? "text-primary" : "text-muted-foreground/40"}
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
