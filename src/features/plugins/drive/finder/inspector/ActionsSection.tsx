import { Brain, ExternalLink, FolderOpen, ScanLine } from "lucide-react";

import type { DriveEntry } from "@/api/drive";
import { Button } from "@/features/shared/components/buttons";
import { useTranslation } from "@/i18n/useTranslation";
import { isOcrEligible } from "../../ocr/useOcr";
import { InspectorSection } from "./InspectorSection";

interface Props {
  entry: DriveEntry;
  onOpen: (entry: DriveEntry) => void;
  onReveal: (entry: DriveEntry) => void;
  onExtractText: (entry: DriveEntry) => void;
  hasGemini: boolean;
  onKnowledge: (entry: DriveEntry) => void;
  knowledgeAvailable: boolean;
}

/**
 * Full-width secondary buttons mirroring the context menu's single-entry
 * actions. Extract text stays visible but disabled without Gemini (same gate
 * as the context menu; `disabledReason` carries the explanation as a tooltip).
 * Add to knowledge base is hidden entirely when the build has no KB lane.
 */
export function ActionsSection({
  entry,
  onOpen,
  onReveal,
  onExtractText,
  hasGemini,
  onKnowledge,
  knowledgeAvailable,
}: Props) {
  const { t } = useTranslation();
  const f = t.plugins.drive.finder;
  const ocrEligible = entry.kind === "file" && isOcrEligible(entry.mime, entry.extension);

  return (
    <InspectorSection title={f.insp_actions} testId="inspector-actions">
      <div className="flex flex-col gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          block
          icon={<ExternalLink className="w-3.5 h-3.5" />}
          onClick={() => onOpen(entry)}
        >
          {f.insp_open}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          block
          icon={<FolderOpen className="w-3.5 h-3.5" />}
          onClick={() => onReveal(entry)}
        >
          {f.insp_reveal}
        </Button>
        {ocrEligible && (
          <Button
            variant="secondary"
            size="sm"
            block
            icon={<ScanLine className="w-3.5 h-3.5" />}
            onClick={() => onExtractText(entry)}
            disabled={!hasGemini}
            disabledReason={f.ctx_extract_text_needs_gemini}
          >
            {f.insp_extract_text}
          </Button>
        )}
        {knowledgeAvailable && (
          <Button
            variant="secondary"
            size="sm"
            block
            icon={<Brain className="w-3.5 h-3.5" />}
            onClick={() => onKnowledge(entry)}
          >
            {f.insp_add_to_kb}
          </Button>
        )}
      </div>
    </InspectorSection>
  );
}
