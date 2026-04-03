import { useState } from "react";
import { X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { ErrorBoundary } from "@/features/shared/components/feedback/ErrorBoundary";
import { useOverviewStore } from "@/stores/overviewStore";
import type { ActiveProcess } from "@/stores/slices/processActivitySlice";
import { useReasoningTrace } from "@/hooks/execution/useReasoningTrace";
import ReasoningTrace from "./ReasoningTrace";

interface DrawerProps {
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Process row
// ---------------------------------------------------------------------------

function elapsedStr(startedAt: number): string {
  const s = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function StatusDot({ status }: { status: ActiveProcess["status"] }) {
  if (status === "running") {
    return <span className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" />;
  }
  if (status === "completed") {
    return <span className="text-green-400 shrink-0 text-xs">{"\u2713"}</span>;
  }
  if (status === "failed") {
    return <span className="text-red-400 shrink-0 text-xs">{"\u2717"}</span>;
  }
  return <span className="text-muted-foreground shrink-0 text-xs">{"\u2014"}</span>;
}

function ProcessRow({
  process,
}: {
  process: ActiveProcess;
  processKey: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const isExecution = process.domain === "execution";
  const executionId = isExecution && expanded ? (process.runId ?? null) : null;
  const { entries, isLive } = useReasoningTrace(executionId);

  return (
    <div className="border-b border-primary/5 last:border-b-0">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-primary/5 transition-colors text-left"
        onClick={() => isExecution && setExpanded((v) => !v)}
      >
        <StatusDot status={process.status} />
        <div className="min-w-0 flex-1">
          <div className="typo-body truncate">
            {process.label ?? process.domain}
            {process.runId && (
              <span className="typo-caption text-muted-foreground/50 ml-1">
                ({process.runId.slice(0, 8)})
              </span>
            )}
          </div>
          {process.lastEvent && (
            <div className="typo-caption text-muted-foreground truncate">{process.lastEvent}</div>
          )}
        </div>
        <div className="typo-caption text-muted-foreground/60 shrink-0 text-right">
          {process.status === "running" ? elapsedStr(process.startedAt) : process.status}
        </div>
      </button>

      {expanded && isExecution && (
        <div className="bg-background/50 border-t border-primary/5">
          <ReasoningTrace entries={entries} isLive={isLive} startTime={process.startedAt} />
          {process.costUsd > 0 && (
            <div className="px-3 pb-2 typo-caption text-muted-foreground/50">
              {process.toolCallCount} tool calls &middot; ${process.costUsd.toFixed(4)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drawer content
// ---------------------------------------------------------------------------

function DrawerContent({ onClose }: DrawerProps) {
  const { activeProcesses, recentProcesses } = useOverviewStore(
    useShallow((s) => ({
      activeProcesses: s.activeProcesses,
      recentProcesses: s.recentProcesses,
    })),
  );

  const activeEntries = Object.entries(activeProcesses);
  const hasContent = activeEntries.length > 0 || recentProcesses.length > 0;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Drawer panel */}
      <div className="fixed top-[var(--titlebar-height,40px)] right-0 bottom-0 w-[380px] z-50 bg-background border-l border-primary/10 flex flex-col shadow-elevation-3 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-primary/10">
          <h3 className="typo-body font-semibold">Process Activity</h3>
          <button
            className="p-1 rounded hover:bg-primary/10 transition-colors"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {!hasContent && (
            <div className="flex items-center justify-center h-full typo-caption text-muted-foreground/50">
              No active or recent processes
            </div>
          )}

          {/* Active section */}
          {activeEntries.length > 0 && (
            <div>
              <div className="px-3 pt-3 pb-1 typo-caption text-muted-foreground/60 uppercase tracking-wide">
                Active ({activeEntries.length})
              </div>
              {activeEntries.map(([key, proc]) => (
                <ProcessRow key={key} processKey={key} process={proc} />
              ))}
            </div>
          )}

          {/* Recent section */}
          {recentProcesses.length > 0 && (
            <div>
              <div className="px-3 pt-3 pb-1 typo-caption text-muted-foreground/60 uppercase tracking-wide">
                Recent
              </div>
              {recentProcesses.map((proc, i) => (
                <ProcessRow
                  key={`recent-${proc.startedAt}-${i}`}
                  processKey={`recent-${i}`}
                  process={proc}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Exported wrapper with ErrorBoundary
// ---------------------------------------------------------------------------

export default function ProcessActivityDrawer(props: DrawerProps) {
  return (
    <ErrorBoundary name="Process Activity">
      <DrawerContent {...props} />
    </ErrorBoundary>
  );
}
