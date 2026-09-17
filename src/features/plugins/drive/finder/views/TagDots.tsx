import type { DriveTag } from "@/api/drive";
import { useTranslation } from "@/i18n/useTranslation";
import { tagColorClass } from "../tagColor";

/** Up to three tag dots; the aria label carries the full count. */
export function TagDots({ tags, className = "" }: { tags: DriveTag[]; className?: string }) {
  const { t, tx } = useTranslation();
  if (tags.length === 0) return null;
  return (
    <span
      className={`inline-flex items-center gap-0.5 flex-shrink-0 ${className}`}
      role="img"
      aria-label={tx(t.plugins.drive.finder.tag_dots_aria, { count: tags.length })}
    >
      {tags.slice(0, 3).map((tag) => (
        <span
          key={tag.id}
          className={`w-2 h-2 rounded-full ring-1 ring-background ${tagColorClass(tag.color)}`}
        />
      ))}
    </span>
  );
}
