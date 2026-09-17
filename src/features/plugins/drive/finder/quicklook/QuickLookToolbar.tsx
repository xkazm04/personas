import { ExternalLink, RefreshCw, RotateCw, X, ZoomIn, ZoomOut } from "lucide-react";

import { Button } from "@/features/shared/components/buttons";
import { Numeric } from "@/features/shared/components/display/Numeric";
import { useTranslation } from "@/i18n/useTranslation";
import { isIdentity, MAX_ZOOM, MIN_ZOOM, type Transform } from "./useQuickLookTransform";

interface Props {
  title: string;
  titleId: string;
  index: number;
  total: number;
  isImage: boolean;
  transform: Transform;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRotate: () => void;
  onReset: () => void;
  onOpenInOs: () => void;
  onClose: () => void;
}

/** Quick Look chrome bar: title, counter, image transform cluster, OS open, close. */
export function QuickLookToolbar({
  title,
  titleId,
  index,
  total,
  isImage,
  transform,
  onZoomIn,
  onZoomOut,
  onRotate,
  onReset,
  onOpenInOs,
  onClose,
}: Props) {
  const { t, tx } = useTranslation();
  const f = t.plugins.drive.finder;
  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 border-b border-card-border bg-card-bg"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex-1 min-w-0">
        <div id={titleId} className="typo-title truncate">
          {title}
        </div>
        {total > 1 && (
          <div className="typo-caption text-foreground">
            {tx(f.ql_counter, { index: index + 1, total })}
          </div>
        )}
      </div>

      {isImage && (
        <div className="flex items-center gap-0.5 p-0.5 rounded-card bg-secondary/30 border border-card-border">
          <Button
            variant="ghost"
            size="icon-sm"
            icon={<ZoomOut className="w-3.5 h-3.5" />}
            aria-label={f.ql_zoom_out}
            title={f.ql_zoom_out}
            onClick={onZoomOut}
            disabled={transform.zoom <= MIN_ZOOM}
          />
          <Numeric value={transform.zoom * 100} precision={0} unit="percent" className="typo-caption text-foreground w-12 text-center select-none" />
          <Button
            variant="ghost"
            size="icon-sm"
            icon={<ZoomIn className="w-3.5 h-3.5" />}
            aria-label={f.ql_zoom_in}
            title={f.ql_zoom_in}
            onClick={onZoomIn}
            disabled={transform.zoom >= MAX_ZOOM}
          />
          <span aria-hidden className="w-px h-4 bg-card-border mx-0.5" />
          <Button
            variant="ghost"
            size="icon-sm"
            icon={<RotateCw className="w-3.5 h-3.5" />}
            aria-label={f.ql_rotate}
            title={f.ql_rotate}
            onClick={onRotate}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            aria-label={f.ql_reset}
            title={f.ql_reset}
            onClick={onReset}
            disabled={isIdentity(transform)}
          />
        </div>
      )}

      <Button
        variant="secondary"
        size="sm"
        icon={<ExternalLink className="w-3.5 h-3.5" />}
        onClick={onOpenInOs}
      >
        {f.ql_open_in_os}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        icon={<X className="w-4 h-4" />}
        aria-label={f.ql_close}
        title={f.ql_close}
        onClick={onClose}
      />
    </div>
  );
}
