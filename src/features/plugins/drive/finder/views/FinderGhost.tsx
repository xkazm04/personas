import { ListSkeleton } from "@/features/shared/components/layout/ListSkeleton";
import { useTranslation } from "@/i18n/useTranslation";
import { ROW_H } from "./listGrouping";

/**
 * Ghost rows for a cold folder. The delay lives on the placeholder
 * (docs/design/overview-loading.md law 3): invisible for the first 120ms so
 * a warm fetch never paints one.
 */
export function FinderGhost({ rows = 8, rowHeight = ROW_H }: { rows?: number; rowHeight?: number }) {
  const { t } = useTranslation();
  return (
    <div className="animate-fade-in" style={{ animationDelay: "120ms" }} data-testid="finder-ghost">
      <span className="sr-only">{t.plugins.drive.loading}</span>
      <ListSkeleton rows={rows} rowHeight={rowHeight} />
    </div>
  );
}
