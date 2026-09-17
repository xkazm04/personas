import { useState, type ReactNode } from "react";

import { useTranslation } from "@/i18n/useTranslation";

import { SplitDivider } from "./SplitDivider";
import { clampPaneWidth } from "./splitPaneMath";

interface Props {
  sidebar: ReactNode;
  main: ReactNode;
  inspector: ReactNode;
  sidebarW: number;
  inspectorW: number;
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  onSidebarW: (w: number) => void;
  onInspectorW: (w: number) => void;
}

/**
 * Sidebar · main · inspector. A closed pane collapses to 0 with a fast width
 * transition (the divider goes with it); during a divider drag the live width
 * is rendered from local preview state and only committed on release, so the
 * persisted prefs are written once per gesture instead of once per pixel.
 */
export function SplitPane({
  sidebar,
  main,
  inspector,
  sidebarW,
  inspectorW,
  sidebarOpen,
  inspectorOpen,
  onSidebarW,
  onInspectorW,
}: Props) {
  const { t } = useTranslation();
  const f = t.plugins.drive.finder;
  const [sidebarPreview, setSidebarPreview] = useState<number | null>(null);
  const [inspectorPreview, setInspectorPreview] = useState<number | null>(null);

  const sideW = sidebarOpen ? (sidebarPreview ?? clampPaneWidth("sidebar", sidebarW)) : 0;
  const inspW = inspectorOpen
    ? (inspectorPreview ?? clampPaneWidth("inspector", inspectorW))
    : 0;
  const animating = sidebarPreview === null && inspectorPreview === null;
  const paneClass = `flex-shrink-0 min-h-0 overflow-hidden ${
    animating ? "transition-[width] duration-fast ease-out" : ""
  }`;

  return (
    <div className="flex-1 min-h-0 flex bg-background" data-testid="finder-split-pane">
      <div
        className={paneClass}
        style={{ width: sideW }}
        aria-hidden={!sidebarOpen}
        data-testid="finder-pane-sidebar"
      >
        <div className="h-full" style={{ width: sidebarPreview ?? clampPaneWidth("sidebar", sidebarW) }}>
          {sidebar}
        </div>
      </div>
      {sidebarOpen && (
        <SplitDivider
          side="sidebar"
          width={sidebarW}
          label={f.sidebar_toggle}
          onPreview={setSidebarPreview}
          onCommit={onSidebarW}
        />
      )}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col relative">{main}</div>
      {inspectorOpen && (
        <SplitDivider
          side="inspector"
          width={inspectorW}
          label={f.inspector_toggle}
          onPreview={setInspectorPreview}
          onCommit={onInspectorW}
        />
      )}
      <div
        className={paneClass}
        style={{ width: inspW }}
        aria-hidden={!inspectorOpen}
        data-testid="finder-pane-inspector"
      >
        <div
          className="h-full"
          style={{ width: inspectorPreview ?? clampPaneWidth("inspector", inspectorW) }}
        >
          {inspector}
        </div>
      </div>
    </div>
  );
}
