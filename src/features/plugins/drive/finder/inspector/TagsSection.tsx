import { useRef, useState } from "react";
import { Settings2, X } from "lucide-react";

import type { DriveEntry, DriveTag } from "@/api/drive";
import { Button } from "@/features/shared/components/buttons";
import { Tooltip } from "@/features/shared/components/display/Tooltip";
import { useTranslation } from "@/i18n/useTranslation";
import { silentCatch } from "@/lib/silentCatch";
import type { DriveMetaApi } from "../types";
import { newTagId } from "../useDriveMeta";
import { TagAddCombobox } from "./TagAddCombobox";
import { tagColorClass } from "../tagColor";
import { TagManagerPopover } from "./TagManagerPopover";
import { TagSwatches, type SwatchState } from "./TagSwatches";
import { InspectorSection } from "./InspectorSection";

interface Props {
  entries: DriveEntry[];
  meta: DriveMetaApi;
}

/**
 * Tags for the selection: the seven colour swatches, the applied named tags
 * as removable chips, an add-combobox and the manager. With several entries
 * a swatch is "on" when every entry carries it and "mixed" when only some do;
 * toggling a mixed swatch applies it to all.
 */
export function TagsSection({ entries, meta }: Props) {
  const { t } = useTranslation();
  const f = t.plugins.drive.finder;
  const manageRef = useRef<HTMLButtonElement>(null);
  const [manageAnchor, setManageAnchor] = useState<DOMRect | null>(null);
  const vocab = meta.meta?.vocab ?? [];
  const builtins = vocab.filter((tag) => tag.builtin);

  const countOf = (tagId: string) =>
    entries.reduce((n, e) => n + (meta.tagsFor(e.path).some((tag) => tag.id === tagId) ? 1 : 0), 0);
  const stateOf = (tagId: string): SwatchState => {
    const n = countOf(tagId);
    return n === 0 ? "off" : n === entries.length ? "on" : "mixed";
  };

  const applyToAll = (tagId: string, on: boolean) => {
    for (const e of entries) {
      const ids = meta.tagsFor(e.path).map((tag) => tag.id);
      const has = ids.includes(tagId);
      if (on && !has) meta.setTags(e.path, [...ids, tagId]).catch(silentCatch("drive:tags:apply"));
      else if (!on && has) meta.setTags(e.path, ids.filter((id) => id !== tagId)).catch(silentCatch("drive:tags:apply"));
    }
  };
  const toggle = (tagId: string) => applyToAll(tagId, stateOf(tagId) !== "on");

  // Named tags shown as chips: any user tag that at least one entry carries.
  const applied: DriveTag[] = vocab.filter((tag) => !tag.builtin && countOf(tag.id) > 0);
  const candidates = vocab.filter((tag) => !tag.builtin && countOf(tag.id) < entries.length);

  const create = (name: string) => {
    const tag: DriveTag = { id: newTagId(), name, color: "gray", builtin: false };
    meta
      .upsertTag(tag)
      .then(() => applyToAll(tag.id, true))
      .catch(silentCatch("drive:tags:create"));
  };

  return (
    <InspectorSection title={f.insp_tags} testId="inspector-tags">
      <div className="space-y-2.5">
        <TagSwatches tags={builtins} stateOf={stateOf} onToggle={toggle} disabled={meta.loading} />

        {applied.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {applied.map((tag) => {
              const mixed = stateOf(tag.id) === "mixed";
              return (
                <span
                  key={tag.id}
                  className={`inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-pill border border-card-border bg-card-bg typo-label text-foreground ${mixed ? "border-dashed" : ""}`}
                >
                  <span className={`w-2 h-2 rounded-full ${tagColorClass(tag.color)}`} />
                  <span className="truncate max-w-[9rem]">{tag.name}</span>
                  <Tooltip content={f.tag_remove}>
                    <button
                      type="button"
                      aria-label={`${f.tag_remove}: ${tag.name}`}
                      onClick={() => applyToAll(tag.id, false)}
                      className="p-0.5 rounded-full hover:bg-secondary/40 focus-ring"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Tooltip>
                </span>
              );
            })}
          </div>
        )}

        <TagAddCombobox
          candidates={candidates}
          onAdd={(id) => applyToAll(id, true)}
          onCreate={create}
          disabled={meta.loading}
        />

        <Button
          ref={manageRef}
          variant="ghost"
          size="sm"
          icon={<Settings2 className="w-3.5 h-3.5" />}
          onClick={() => setManageAnchor(manageRef.current?.getBoundingClientRect() ?? null)}
        >
          {f.tag_manage}
        </Button>
        <TagManagerPopover
          open={manageAnchor !== null}
          anchor={manageAnchor}
          meta={meta}
          onClose={() => setManageAnchor(null)}
        />
      </div>
    </InspectorSection>
  );
}
