import type { ReactNode } from "react";

import { driveFormatBytes, type DriveEntry } from "@/api/drive";
import { CopyButton } from "@/features/shared/components/buttons/CopyButton";
import { AbsoluteTime } from "@/features/shared/components/display/AbsoluteTime";
import { Numeric } from "@/features/shared/components/display/Numeric";
import { useTranslation } from "@/i18n/useTranslation";
import { kindLabel, visualForEntry } from "../../designTokens";
import { InspectorSection } from "./InspectorSection";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-2 py-1 items-start">
      <span className="typo-caption text-foreground">{label}</span>
      <span className="typo-body text-foreground break-words min-w-0">{children}</span>
    </div>
  );
}

/** Kind · size · modified · path (with copy) for a single entry. */
export function GeneralSection({ entry }: { entry: DriveEntry }) {
  const { t } = useTranslation();
  const f = t.plugins.drive.finder;
  const visual = visualForEntry(entry);
  const kind = entry.kind === "folder" ? t.plugins.drive.folder_kind : kindLabel(t, visual);
  const path = entry.path || "/";

  return (
    <InspectorSection title={f.insp_general} testId="inspector-general">
      <Row label={f.insp_kind}>{kind}</Row>
      {entry.kind === "file" && (
        <Row label={f.insp_size}>
          <Numeric>{driveFormatBytes(entry.size)}</Numeric>
        </Row>
      )}
      <Row label={f.insp_modified}>
        <AbsoluteTime timestamp={entry.modified} />
      </Row>
      <Row label={f.insp_path}>
        <span className="flex items-start gap-1">
          <span className="typo-code break-all flex-1">{path}</span>
          <CopyButton text={path} label={f.insp_copy_path} tooltip={f.insp_copy_path} />
        </span>
      </Row>
    </InspectorSection>
  );
}
