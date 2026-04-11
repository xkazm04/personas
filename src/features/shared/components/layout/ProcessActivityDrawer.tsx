import { useState } from "react";
import { X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { ErrorBoundary } from "@/features/shared/components/feedback/ErrorBoundary";
import { useOverviewStore } from "@/stores/overviewStore";
import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";
import { useTranslation } from "@/i18n/useTranslation";
import type { ActiveProcess } from "@/stores/slices/processActivitySlice";
import { useReasoningTrace } from "@/hooks/execution/useReasoningTrace";
import ReasoningTrace from "./ReasoningTrace";
import type { SidebarSection, DevToolsTab, PluginTab } from "@/lib/types/types";

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
  if (status === "queued") {
    return <span className="inline-block w-2 h-2 rounded-full bg-amber-400 shrink-0" />;
  }
  if (status === "input_required") {
    return <span className="inline-block w-2 h-2 rounded-full bg-orange-400 animate-pulse shrink-0" />;
  }
  if (status === "draft_ready") {
    return <span className="inline-block w-2 h-2 rounded-full bg-violet-400 shrink-0" />;
  }
  if (status === "completed") {
    return <span className="text-green-400 shrink-0 text-xs">{"\u2713"}</span>;
  }
  if (status === "failed") {
    return <span className="text-red-400 shrink-0 text-xs">{"\u2717"}</span>;
  }
  return <span className="text-foreground shrink-0 text-xs">{"\u2014"}</span>;
}

function useStatusLabel() {
  const { t } = useTranslation();
  return (status: ActiveProcess["status"], queuePosition?: number): string => {
    switch (status) {
      case "running": return "";          // elapsed timer shown instead
      case "queued": return t.shared.process_in_queue.replace('{position}', String((queuePosition ?? 0) + 1));
      case "input_required": return t.shared.process_input_required;
      case "draft_ready": return t.shared.process_draft_ready;
      default: return status;
    }
  };
}

function ProcessRow({
  process,
  onNavigate,
}: {
  process: ActiveProcess;
  processKey: string;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const statusLabel = useStatusLabel();
  const [expanded, setExpanded] = useState(false);
  const isExecution = process.domain === "execution";
  const executionId = isExecution && expanded ? (process.runId ?? null) : null;
  const { entries, isLive } = useReasoningTrace(executionId);
  const hasNav = !!process.navigateTo;

  const handleClick = () => {
    if (hasNav && onNavigate) {
      onNavigate();
      return;
    }
    if (isExecution && process.status === "running") {
      setExpanded((v) => !v);
    }
  };

  return (
    <div className="border-b border-primary/5 last:border-b-0">
      <button
        className={`w-full flex items-center gap-2 px-3 py-2 hover:bg-primary/5 transition-colors text-left ${
          hasNav ? "cursor-pointer" : ""
        }`}
        onClick={handleClick}
      >
        <StatusDot status={process.status} />
        <div className="min-w-0 flex-1">
          <div className="typo-body truncate">
            {process.label ?? process.domain}
            {process.runId && (
              <span className="typo-caption text-foreground ml-1">
                ({process.runId.slice(0, 8)})
              </span>
            )}
          </div>
          {process.lastEvent && (
            <div className="typo-caption text-foreground truncate">{process.lastEvent}</div>
          )}
        </div>
        <div className="typo-caption text-foreground shrink-0 text-right">
          {process.status === "running"
            ? elapsedStr(process.startedAt)
            : statusLabel(process.status, process.queuePosition)}
        </div>
        {hasNav && (
          <span className="text-primary/40 text-xs shrink-0 ml-1">&rsaquo;</span>
        )}
      </button>

      {expanded && isExecution && (
        <div className="bg-background/50 border-t border-primary/5">
          <ReasoningTrace entries={entries} isLive={isLive} startTime={process.startedAt} />
          {process.costUsd > 0 && (
            <div className="px-3 pb-2 typo-caption text-foreground">
              {t.shared.process_tool_calls.replace('{count}', String(process.toolCallCount))} &middot; ${process.costUsd.toFixed(4)}
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
  const { t } = useTranslation();
  const { activeProcesses, recentProcesses } = useOverviewStore(
    useShallow((s) => ({
      activeProcesses: s.activeProcesses,
      recentProcesses: s.recentProcesses,
    })),
  );
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setTemplateTab = useSystemStore((s) => s.setTemplateTab);
  const setEditorTab = useSystemStore((s) => s.setEditorTab);
  const setPluginTab = useSystemStore((s) => s.setPluginTab);
  const setDevToolsTab = useSystemStore((s) => s.setDevToolsTab);

  const navigateToProcess = (process: ActiveProcess) => {
    if (!process.navigateTo) return;
    const { section, tab, personaId } = process.navigateTo;
    setSidebarSection(section as SidebarSection);
    if (tab) {
      if (section === 'personas') {
        setEditorTab(tab as "matrix" | "activity");
      } else if (section === 'plugins') {
        // Plugins section: tab is the dev-tools sub-tab. Always activate dev-tools.
        setPluginTab('dev-tools' as PluginTab);
        setDevToolsTab(tab as DevToolsTab);
      } else {
        setTemplateTab(tab as "n8n" | "generated");
      }
    }
    if (personaId) {
      useAgentStore.getState().selectPersona(personaId);
    }
    onClose();
  };

  const runningEntries = Object.entries(activeProcesses).filter(
    ([, p]) => p.status === "running",
  );
  const actionEntries = Object.entries(activeProcesses).filter(
    ([, p]) => p.status === "input_required" || p.status === "draft_ready",
  );
  const queuedEntries = Object.entries(activeProcesses)
    .filter(([, p]) => p.status === "queued")
    .sort((a, b) => (a[1].queuePosition ?? 99) - (b[1].queuePosition ?? 99));

  const hasContent = runningEntries.length > 0 || actionEntries.length > 0 || queuedEntries.length > 0 || recentProcesses.length > 0;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Drawer panel */}
      <div className="fixed top-[var(--titlebar-height,40px)] right-0 bottom-0 w-[380px] z-50 bg-background border-l border-primary/10 flex flex-col shadow-elevation-3 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-primary/10">
          <h3 className="typo-body font-semibold">{t.shared.process_activity}</h3>
          <div className="flex items-center gap-1">
            {(actionEntries.length > 0 || queuedEntries.length > 0 || recentProcesses.length > 0) && (
              <button
                className="px-2 py-1 rounded text-[10px] text-foreground hover:text-foreground hover:bg-primary/10 transition-colors"
                onClick={() => useOverviewStore.getState().clearNonActive()}
                title="Clear completed and queued items"
              >
                {t.common.clear}
              </button>
            )}
            <button
              className="p-1 rounded hover:bg-primary/10 transition-colors"
              onClick={onClose}
              aria-label={t.common.close}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {!hasContent && (
            <div className="flex items-center justify-center h-full typo-caption text-foreground">
              {t.shared.process_empty}
            </div>
          )}

          {/* Action required section (input_required, draft_ready) */}
          {actionEntries.length > 0 && (
            <div>
              <div className="px-3 pt-3 pb-1 typo-caption text-orange-400 uppercase tracking-wide">
                {t.shared.process_action_required} ({actionEntries.length})
              </div>
              {actionEntries.map(([key, proc]) => (
                <ProcessRow key={key} processKey={key} process={proc} onNavigate={() => navigateToProcess(proc)} />
              ))}
            </div>
          )}

          {/* Active (running) section */}
          {runningEntries.length > 0 && (
            <div>
              <div className="px-3 pt-3 pb-1 typo-caption text-foreground uppercase tracking-wide">
                {t.shared.process_active} ({runningEntries.length})
              </div>
              {runningEntries.map(([key, proc]) => (
                <ProcessRow key={key} processKey={key} process={proc} onNavigate={() => navigateToProcess(proc)} />
              ))}
            </div>
          )}

          {/* Queued section */}
          {queuedEntries.length > 0 && (
            <div>
              <div className="px-3 pt-3 pb-1 typo-caption text-foreground uppercase tracking-wide">
                {t.shared.process_queued} ({queuedEntries.length})
              </div>
              {queuedEntries.map(([key, proc]) => (
                <ProcessRow key={key} processKey={key} process={proc} onNavigate={() => navigateToProcess(proc)} />
              ))}
            </div>
          )}

          {/* Recent section */}
          {recentProcesses.length > 0 && (
            <div>
              <div className="px-3 pt-3 pb-1 typo-caption text-foreground uppercase tracking-wide">
                {t.shared.process_recent}
              </div>
              {recentProcesses.map((proc, i) => (
                <ProcessRow
                  key={`recent-${proc.startedAt}-${i}`}
                  processKey={`recent-${i}`}
                  process={proc}
                  onNavigate={() => navigateToProcess(proc)}
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
