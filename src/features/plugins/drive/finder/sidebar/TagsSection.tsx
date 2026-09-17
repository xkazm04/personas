import { useCallback, useState } from "react";
import { Settings2 } from "lucide-react";

import type { DriveTag } from "@/api/drive";
import { silentCatch } from "@/lib/silentCatch";
import { useTranslation } from "@/i18n/useTranslation";
import Button from "@/features/shared/components/buttons/Button";

import { parseDriveMovePayload } from "../../hooks/useDrive";
import { tagColorClass } from "../tagColor";
import type { DriveMetaApi } from "../types";
import { hasMovePayload } from "./TreeNode";

interface Props {
  meta: DriveMetaApi;
  activeTagId: string | null;
  onPickTag: (tag: DriveTag) => void;
  onManageTags: () => void;
}

/**
 * One row per vocab tag. Click filters Drive to that tag (the tagged view);
 * dropping an internal drag onto a row applies the tag to every dragged path.
 */
export function TagsSection({ meta, activeTagId, onPickTag, onManageTags }: Props) {
  const { t } = useTranslation();
  const f = t.plugins.drive.finder;
  const [dropTag, setDropTag] = useState<string | null>(null);
  const vocab = meta.meta?.vocab ?? [];

  const applyTag = useCallback(
    async (tag: DriveTag, paths: string[]) => {
      for (const p of paths) {
        const ids = meta.tagsFor(p).map((x) => x.id);
        if (!ids.includes(tag.id)) await meta.setTags(p, [...ids, tag.id]);
      }
    },
    [meta],
  );

  return (
    <section aria-label={f.tags_section} className="px-2 pt-3">
      <div className="px-2 mb-1 flex items-center typo-label text-foreground">
        <span className="flex-1">{f.tags_section}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={f.tag_manage}
          title={f.tag_manage}
          onClick={onManageTags}
        >
          <Settings2 className="w-3.5 h-3.5" />
        </Button>
      </div>
      {vocab.length === 0 ? (
        <p className="px-2 py-1 typo-caption text-foreground">{f.tags_empty}</p>
      ) : (
        <div role="list">
          {vocab.map((tag) => {
            const active = tag.id === activeTagId;
            const over = tag.id === dropTag;
            return (
              <button
                key={tag.id}
                type="button"
                role="listitem"
                aria-pressed={active}
                onClick={() => onPickTag(tag)}
                onDragOver={(e) => {
                  if (!hasMovePayload(e)) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "link";
                  setDropTag(tag.id);
                }}
                onDragLeave={() => setDropTag(null)}
                onDrop={(e) => {
                  setDropTag(null);
                  if (!hasMovePayload(e)) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const paths = parseDriveMovePayload(e);
                  if (paths) applyTag(tag, paths).catch(silentCatch("finder:tag-drop"));
                }}
                className={`w-full flex items-center gap-2 py-1 px-2 rounded-input text-left typo-body transition-colors duration-fast focus-ring ${
                  over
                    ? "bg-accent/20 ring-1 ring-accent/60"
                    : active
                      ? "bg-primary/15 ring-1 ring-primary/40"
                      : "text-foreground hover:bg-secondary/50"
                }`}
              >
                <span aria-hidden className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${tagColorClass(tag.color)}`} />
                <span className="truncate flex-1">{tag.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
