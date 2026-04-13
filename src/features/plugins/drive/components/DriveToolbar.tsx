import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  FolderPlus,
  FilePlus,
  FileSignature,
  Grid3x3,
  List,
  Columns3,
  RefreshCw,
  Search,
  X,
  Home,
  type LucideIcon,
} from "lucide-react";

import type { UseDriveResult, ViewMode } from "../hooks/useDrive";
import { useTranslation } from "@/i18n/useTranslation";

interface Props {
  drive: UseDriveResult;
  onNewFolder: () => void;
  onNewFile: () => void;
  onOpenSignatures: () => void;
}

export function DriveToolbar({
  drive,
  onNewFolder,
  onNewFile,
  onOpenSignatures,
}: Props) {
  const { t } = useTranslation();

  const segments = drive.currentPath
    ? drive.currentPath.split("/").filter(Boolean)
    : [];

  return (
    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-primary/10 bg-gradient-to-b from-background/70 to-background/40 backdrop-blur-sm">
      {/* Nav cluster */}
      <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-secondary/40 border border-primary/10">
        <IconButton
          icon={ArrowLeft}
          label={t.plugins.drive.back}
          onClick={drive.goBack}
          disabled={!drive.canGoBack}
        />
        <IconButton
          icon={ArrowRight}
          label={t.plugins.drive.forward}
          onClick={drive.goForward}
          disabled={!drive.canGoForward}
        />
        <IconButton
          icon={ArrowUp}
          label={t.plugins.drive.up}
          onClick={drive.goUp}
          disabled={!drive.currentPath}
        />
        <span className="w-px h-4 bg-primary/15 mx-0.5" />
        <IconButton
          icon={RefreshCw}
          label={t.plugins.drive.refresh}
          onClick={drive.refresh}
        />
      </div>

      {/* Breadcrumb */}
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-0.5 min-w-0 flex-1 px-2 py-1 rounded-lg bg-secondary/30 border border-primary/10"
      >
        <BreadcrumbPill
          label={t.plugins.drive.sidebar_root}
          icon={Home}
          onClick={() => drive.navigate("")}
          isLast={segments.length === 0}
        />
        {segments.map((seg, i) => {
          const subPath = segments.slice(0, i + 1).join("/");
          const isLast = i === segments.length - 1;
          return (
            <div key={subPath} className="flex items-center gap-0.5 min-w-0">
              <ChevronRight className="w-3 h-3 text-foreground/40 flex-shrink-0" />
              <BreadcrumbPill
                label={seg}
                onClick={() => drive.navigate(subPath)}
                isLast={isLast}
              />
            </div>
          );
        })}
      </nav>

      {/* Search */}
      <div className="relative flex items-center group">
        <Search className="absolute left-2.5 w-3.5 h-3.5 text-foreground/50 pointer-events-none transition-colors group-focus-within:text-cyan-400" />
        <input
          type="text"
          value={drive.searchQuery}
          onChange={(e) => drive.setSearchQuery(e.target.value)}
          placeholder={t.plugins.drive.search_placeholder}
          className="pl-8 pr-7 py-1.5 w-56 rounded-lg bg-secondary/40 border border-primary/15 typo-caption text-foreground placeholder:text-foreground/45 focus:outline-none focus:border-cyan-500/40 focus:ring-2 focus:ring-cyan-500/20 transition-all"
        />
        {drive.searchQuery && (
          <button
            type="button"
            onClick={() => drive.setSearchQuery("")}
            className="absolute right-1.5 p-0.5 rounded text-foreground/50 hover:text-foreground hover:bg-primary/10"
            aria-label="clear"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* View toggle (segmented) */}
      <div className="flex items-center gap-0 p-0.5 rounded-lg bg-secondary/40 border border-primary/10">
        <ViewSegment
          mode="list"
          label={t.plugins.drive.view_list}
          icon={List}
          active={drive.viewMode === "list"}
          onClick={() => drive.setViewMode("list")}
        />
        <ViewSegment
          mode="icons"
          label={t.plugins.drive.view_icons}
          icon={Grid3x3}
          active={drive.viewMode === "icons"}
          onClick={() => drive.setViewMode("icons")}
        />
        <ViewSegment
          mode="columns"
          label={t.plugins.drive.view_columns}
          icon={Columns3}
          active={drive.viewMode === "columns"}
          onClick={() => drive.setViewMode("columns")}
        />
      </div>

      {/* Actions */}
      <ActionButton
        icon={FolderPlus}
        label={t.plugins.drive.new_folder}
        onClick={onNewFolder}
        variant="primary"
      />
      <ActionButton
        icon={FilePlus}
        label={t.plugins.drive.new_file}
        onClick={onNewFile}
        variant="ghost"
      />
      <ActionButton
        icon={FileSignature}
        label={t.plugins.drive.signatures_button}
        onClick={onOpenSignatures}
        variant="accent"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function IconButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="p-1.5 rounded-md text-foreground/75 hover:text-foreground hover:bg-primary/10 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}

function BreadcrumbPill({
  label,
  icon: Icon,
  onClick,
  isLast,
}: {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  isLast: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 px-2 py-1 rounded-md typo-caption truncate max-w-[160px] transition-colors ${
        isLast
          ? "text-foreground font-semibold"
          : "text-foreground/70 hover:text-foreground hover:bg-primary/10"
      }`}
    >
      {Icon && <Icon className="w-3.5 h-3.5 flex-shrink-0" />}
      <span className="truncate">{label}</span>
    </button>
  );
}

function ViewSegment({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  mode: ViewMode;
  label: string;
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md typo-caption-sm font-medium transition-all ${
        active
          ? "bg-gradient-to-b from-cyan-500/30 to-cyan-500/10 text-cyan-100 shadow-sm border border-cyan-500/40"
          : "text-foreground/65 hover:text-foreground hover:bg-primary/10 border border-transparent"
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  variant,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  variant: "primary" | "ghost" | "accent";
}) {
  const styles = {
    primary:
      "bg-gradient-to-b from-cyan-500/25 to-cyan-500/10 text-cyan-100 border border-cyan-500/40 hover:from-cyan-500/35 hover:to-cyan-500/15 shadow-[0_0_12px_-4px_rgba(34,211,238,0.4)]",
    ghost:
      "bg-secondary/50 text-foreground/85 border border-primary/15 hover:bg-secondary/70 hover:text-foreground",
    accent:
      "bg-gradient-to-b from-fuchsia-500/25 to-rose-500/10 text-fuchsia-100 border border-fuchsia-500/40 hover:from-fuchsia-500/35 hover:to-rose-500/15 shadow-[0_0_12px_-4px_rgba(217,70,239,0.4)]",
  } as const;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg typo-caption font-semibold transition-all ${styles[variant]}`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}
