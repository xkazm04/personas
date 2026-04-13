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

  const iconBtn =
    "p-1.5 rounded-md text-foreground/70 hover:text-foreground hover:bg-secondary/60 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors";

  const viewBtn = (mode: ViewMode, Icon: typeof List, label: string) => (
    <button
      key={mode}
      type="button"
      onClick={() => drive.setViewMode(mode)}
      title={label}
      aria-label={label}
      className={`p-1.5 rounded-md transition-colors ${
        drive.viewMode === mode
          ? "bg-sky-500/20 text-sky-400 border border-sky-500/30"
          : "text-foreground/60 hover:bg-secondary/60 hover:text-foreground border border-transparent"
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10 bg-background/50">
      <button
        type="button"
        onClick={drive.goBack}
        disabled={!drive.canGoBack}
        title={t.plugins.drive.back}
        aria-label={t.plugins.drive.back}
        className={iconBtn}
      >
        <ArrowLeft className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={drive.goForward}
        disabled={!drive.canGoForward}
        title={t.plugins.drive.forward}
        aria-label={t.plugins.drive.forward}
        className={iconBtn}
      >
        <ArrowRight className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={drive.goUp}
        disabled={!drive.currentPath}
        title={t.plugins.drive.up}
        aria-label={t.plugins.drive.up}
        className={iconBtn}
      >
        <ArrowUp className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={drive.refresh}
        title={t.plugins.drive.refresh}
        aria-label={t.plugins.drive.refresh}
        className={iconBtn}
      >
        <RefreshCw className="w-4 h-4" />
      </button>

      <div className="w-px h-5 bg-primary/15 mx-1" />

      {/* Breadcrumb */}
      <nav className="flex items-center gap-0.5 min-w-0 flex-1">
        <button
          type="button"
          onClick={() => drive.navigate("")}
          className="flex items-center gap-1 px-2 py-1 rounded-md typo-caption text-foreground/70 hover:text-foreground hover:bg-secondary/50"
        >
          <Home className="w-3.5 h-3.5" />
          {t.plugins.drive.sidebar_root}
        </button>
        {segments.map((seg, i) => {
          const subPath = segments.slice(0, i + 1).join("/");
          const isLast = i === segments.length - 1;
          return (
            <div key={subPath} className="flex items-center gap-0.5 min-w-0">
              <ChevronRight className="w-3 h-3 text-foreground/30 flex-shrink-0" />
              <button
                type="button"
                onClick={() => drive.navigate(subPath)}
                className={`px-2 py-1 rounded-md typo-caption truncate max-w-[160px] ${
                  isLast
                    ? "text-foreground font-medium"
                    : "text-foreground/70 hover:text-foreground hover:bg-secondary/50"
                }`}
              >
                {seg}
              </button>
            </div>
          );
        })}
      </nav>

      {/* Search */}
      <div className="relative flex items-center">
        <Search className="absolute left-2 w-3.5 h-3.5 text-foreground/40 pointer-events-none" />
        <input
          type="text"
          value={drive.searchQuery}
          onChange={(e) => drive.setSearchQuery(e.target.value)}
          placeholder={t.plugins.drive.search_placeholder}
          className="pl-7 pr-7 py-1 w-48 rounded-md bg-secondary/40 border border-primary/15 typo-caption text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-1 focus:ring-sky-500/40"
        />
        {drive.searchQuery && (
          <button
            type="button"
            onClick={() => drive.setSearchQuery("")}
            className="absolute right-1.5 p-0.5 text-foreground/40 hover:text-foreground"
            aria-label="clear"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* View toggle */}
      <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-secondary/30">
        {viewBtn("list", List, t.plugins.drive.view_list)}
        {viewBtn("icons", Grid3x3, t.plugins.drive.view_icons)}
        {viewBtn("columns", Columns3, t.plugins.drive.view_columns)}
      </div>

      {/* Actions */}
      <button
        type="button"
        onClick={onNewFolder}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-sky-500/15 text-sky-400 border border-sky-500/25 typo-caption font-medium hover:bg-sky-500/20 transition-colors"
      >
        <FolderPlus className="w-3.5 h-3.5" />
        {t.plugins.drive.new_folder}
      </button>
      <button
        type="button"
        onClick={onNewFile}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-secondary/50 text-foreground/80 border border-primary/15 typo-caption font-medium hover:bg-secondary/70 transition-colors"
      >
        <FilePlus className="w-3.5 h-3.5" />
        {t.plugins.drive.new_file}
      </button>
      <button
        type="button"
        onClick={onOpenSignatures}
        title={t.plugins.drive.signatures_button}
        aria-label={t.plugins.drive.signatures_button}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-500/10 text-rose-300 border border-rose-500/25 typo-caption font-medium hover:bg-rose-500/20 transition-colors"
      >
        <FileSignature className="w-3.5 h-3.5" />
        {t.plugins.drive.signatures_button}
      </button>
    </div>
  );
}
