import { FileSignature, ShieldCheck } from "lucide-react";

import type { DriveEntry } from "@/api/drive";
import { Button } from "@/features/shared/components/buttons";
import { StatusBadge } from "@/features/shared/components/display/StatusBadge";
import { useTranslation } from "@/i18n/useTranslation";
import { InspectorSection } from "./InspectorSection";

interface Props {
  entry: DriveEntry;
  signed: boolean;
  onSign: (entry: DriveEntry) => void;
  onVerify: (entry: DriveEntry) => void;
}

/** Signed / Not signed badge plus the Sign and Verify actions. Files only. */
export function SignatureSection({ entry, signed, onSign, onVerify }: Props) {
  const { t } = useTranslation();
  const f = t.plugins.drive.finder;
  if (entry.kind !== "file") return null;

  return (
    <InspectorSection
      title={f.insp_signature}
      testId="inspector-signature"
      trailing={
        <StatusBadge
          variant={signed ? "success" : "neutral"}
          size="sm"
          pill
          icon={<FileSignature className="w-3 h-3" />}
        >
          {signed ? f.insp_signed : f.insp_unsigned}
        </StatusBadge>
      }
    >
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          block
          icon={<FileSignature className="w-3.5 h-3.5" />}
          onClick={() => onSign(entry)}
        >
          {f.insp_sign}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          block
          icon={<ShieldCheck className="w-3.5 h-3.5" />}
          onClick={() => onVerify(entry)}
        >
          {f.insp_verify}
        </Button>
      </div>
    </InspectorSection>
  );
}
