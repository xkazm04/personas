import type { RefObject } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Columns3,
  FileSignature,
  FolderPlus,
  FolderInput,
  FolderOutput,
  Grid3x3,
  Image,
  List,
  Move,
  PanelLeft,
  PanelRight,
  RefreshCw,
} from "lucide-react";

import { useTranslation } from "@/i18n/useTranslation";
import Button from "@/features/shared/components/buttons/Button";
import { Tooltip } from "@/features/shared/components/display/Tooltip";
import { SegmentedTabs } from "@/features/shared/components/layout/SegmentedTabs";

import type { DriveApi, FinderViewMode } from "../types";
import type { FinderPrefsApi } from "../useFinderPrefs";
import { FinderBreadcrumb } from "./FinderBreadcrumb";
import { FinderPathInput } from "./FinderPathInput";
import { FinderSearch } from "./FinderSearch";

interface Props {
  drive: DriveApi;
  prefs: FinderPrefsApi;
  activeDragCount: number | null;
  searchRef: RefObject<HTMLInputElement | null>;
  hasSelection: boolean;
  pathEditing: boolean;
  onPathEditingChange: (v: boolean) => void;
  onImport: () => void;
  onExport: () => void;
  onMoveTo: (anchor: DOMRect) => void;
  onNewFolder: () => void;
  onOpenSignatures: () => void;
}

function IconAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip content={label} triggerFocusable={disabled}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        className={disabled ? "pointer-events-none" : ""}
      >
        {children}
      </Button>
    </Tooltip>
  );
}

export function FinderToolbar(p: Props) {
  const { drive, prefs, hasSelection } = p;
  const { t } = useTranslation();
  const f = t.plugins.drive.finder;
  const view = prefs.prefs;
  const ic = "w-3.5 h-3.5";

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border glass-md" data-testid="finder-toolbar">
      <IconAction label={f.sidebar_toggle} onClick={() => prefs.setSidebarOpen(!view.sidebarOpen)}>
        <PanelLeft className={ic} />
      </IconAction>
      <div className="flex items-center gap-0.5 p-0.5 rounded-card bg-secondary/30 border border-border">
        <IconAction label={f.back} onClick={drive.goBack} disabled={!drive.canGoBack}>
          <ArrowLeft className={ic} />
        </IconAction>
        <IconAction label={f.forward} onClick={drive.goForward} disabled={!drive.canGoForward}>
          <ArrowRight className={ic} />
        </IconAction>
        <IconAction label={f.up} onClick={drive.goUp} disabled={!drive.currentPath}>
          <ArrowUp className={ic} />
        </IconAction>
        <span aria-hidden className="w-px h-4 bg-border mx-0.5" />
        <IconAction label={f.refresh} onClick={drive.refresh}>
          <RefreshCw className={ic} />
        </IconAction>
      </div>

      {p.pathEditing ? (
        <FinderPathInput drive={drive} onDone={() => p.onPathEditingChange(false)} />
      ) : (
        <FinderBreadcrumb
          drive={drive}
          activeDragCount={p.activeDragCount}
          onEditPath={() => p.onPathEditingChange(true)}
        />
      )}
      <FinderSearch drive={drive} inputRef={p.searchRef} />

      <SegmentedTabs<FinderViewMode>
        tabs={[
          { id: "list", label: <List className={ic} />, ariaLabel: f.view_list },
          { id: "icons", label: <Grid3x3 className={ic} />, ariaLabel: f.view_icons },
          { id: "columns", label: <Columns3 className={ic} />, ariaLabel: f.view_columns },
          { id: "gallery", label: <Image className={ic} />, ariaLabel: f.view_gallery },
        ]}
        activeTab={view.viewMode}
        onTabChange={prefs.setViewMode}
        ariaLabel={f.view_switcher_aria}
        size="sm"
        fullWidth={false}
      />

      <div className="flex items-center gap-1">
        {hasSelection ? (
          <>
            <Button
              variant="primary"
              size="sm"
              icon={<Move className={ic} />}
              onClick={(e) => p.onMoveTo(e.currentTarget.getBoundingClientRect())}
            >
              {f.move_to}
            </Button>
            <Button variant="secondary" size="sm" icon={<FolderOutput className={ic} />} onClick={p.onExport}>
              {f.export_to}
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" icon={<FolderPlus className={ic} />} onClick={p.onNewFolder}>
            {f.new_folder}
          </Button>
        )}
        <Button variant="ghost" size="sm" icon={<FolderInput className={ic} />} onClick={p.onImport}>
          {f.import}
        </Button>
        <IconAction label={t.plugins.drive.signatures_button} onClick={p.onOpenSignatures}>
          <FileSignature className={ic} />
        </IconAction>
        <IconAction
          label={`${f.inspector_toggle} (${f.kbd_hint_inspector})`}
          onClick={() => prefs.setInspectorOpen(!view.inspectorOpen)}
        >
          <PanelRight className={ic} />
        </IconAction>
      </div>
    </div>
  );
}
