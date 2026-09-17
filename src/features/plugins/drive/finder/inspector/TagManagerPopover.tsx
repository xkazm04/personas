import { useState } from "react";
import { Trash2 } from "lucide-react";

import { DRIVE_TAG_COLORS, type DriveTag, type DriveTagColor } from "@/api/drive";
import { Button } from "@/features/shared/components/buttons";
import { InlineEditableText } from "@/features/shared/components/display/InlineEditableText";
import { ConfirmDialog } from "@/features/shared/components/feedback/ConfirmDialog";
import { QuickEditPopover } from "@/features/shared/components/overlays/QuickEditPopover";
import { useTranslation } from "@/i18n/useTranslation";
import { silentCatch } from "@/lib/silentCatch";
import type { DriveMetaApi } from "../types";
import { tagColorClass, tagRingClass } from "../tagColor";
import { colorName } from "./TagSwatches";

interface Props {
  open: boolean;
  anchor: DOMRect | null;
  meta: DriveMetaApi;
  onClose: () => void;
}

function ColorPicker({ value, onPick }: { value: DriveTagColor; onPick: (c: DriveTagColor) => void }) {
  const { t } = useTranslation();
  return (
    <div role="radiogroup" aria-label={t.plugins.drive.finder.tag_color} className="flex items-center gap-1">
      {DRIVE_TAG_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={color === value}
          aria-label={colorName(t, color)}
          title={colorName(t, color)}
          onClick={() => onPick(color)}
          className={`w-3.5 h-3.5 rounded-full focus-ring ${tagColorClass(color)} ${
            color === value ? `ring-2 ring-offset-1 ring-offset-background ${tagRingClass(color)}` : "opacity-60 hover:opacity-100"
          }`}
        />
      ))}
    </div>
  );
}

/**
 * "Manage tags": every user tag with inline rename, a colour picker and a
 * confirmed delete. Edits apply immediately through `meta` (optimistic), so
 * the popover's Save is simply Done.
 */
export function TagManagerPopover({ open, anchor, meta, onClose }: Props) {
  const { t, tx } = useTranslation();
  const f = t.plugins.drive.finder;
  const [pendingDelete, setPendingDelete] = useState<DriveTag | null>(null);
  const userTags = (meta.meta?.vocab ?? []).filter((tag) => !tag.builtin);

  return (
    <>
      <QuickEditPopover open={open} anchor={anchor} title={f.tag_manage} onClose={onClose} onSave={onClose}>
        {userTags.length === 0 ? (
          <p className="typo-caption text-foreground">{f.tags_empty}</p>
        ) : (
          <ul className="space-y-2">
            {userTags.map((tag) => (
              <li key={tag.id} className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${tagColorClass(tag.color)}`} />
                <InlineEditableText
                  value={tag.name}
                  renameLabel={f.tag_rename}
                  className="flex-1 min-w-0 typo-body text-foreground"
                  onCommit={(next) => {
                    const name = next.trim();
                    if (name && name !== tag.name) {
                      meta.upsertTag({ ...tag, name }).catch(silentCatch("drive:tags:rename"));
                    }
                  }}
                />
                <ColorPicker
                  value={tag.color}
                  onPick={(color) => {
                    if (color !== tag.color) {
                      meta.upsertTag({ ...tag, color }).catch(silentCatch("drive:tags:recolour"));
                    }
                  }}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  icon={<Trash2 className="w-3.5 h-3.5" />}
                  aria-label={f.tag_delete}
                  title={f.tag_delete}
                  onClick={() => setPendingDelete(tag)}
                />
              </li>
            ))}
          </ul>
        )}
      </QuickEditPopover>

      {pendingDelete && (
        <ConfirmDialog
          danger
          title={tx(f.tag_delete_confirm_title, { name: pendingDelete.name })}
          body={f.tag_delete_confirm_body}
          confirmLabel={f.tag_delete}
          onConfirm={async () => {
            await meta.deleteTag(pendingDelete.id);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </>
  );
}
