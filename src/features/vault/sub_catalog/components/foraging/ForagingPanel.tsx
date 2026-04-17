import { useCallback } from "react";
import { ArrowLeft } from "lucide-react";
import { useCredentialForaging } from "@/hooks/design/credential/useCredentialForaging";
import { ForagingStepIndicator } from "./ForagingStepIndicator";
import { ForagingResults } from "./ForagingResults";
import {
  ForagingIdle,
  ForagingScanning,
  ForagingImporting,
  ForagingDone,
  ForagingError,
} from "./ForagingStatusPanels";
import { Button } from "@/features/shared/components/buttons";
import { useTranslation } from "@/i18n/useTranslation";

interface ForagingPanelProps {
  onComplete: () => void;
  onBack: () => void;
}

export function ForagingPanel({ onComplete, onBack }: ForagingPanelProps) {
  const { t, tx } = useTranslation();
  const forage = useCredentialForaging();

  const handleImport = useCallback(() => {
    forage.importSelected(onComplete);
  }, [forage, onComplete]);

  const importableCount = forage.scanResult
    ? forage.scanResult.credentials.filter((c) => !c.already_imported).length
    : 0;

  return (
    <div
      key="foraging"
      className="animate-fade-slide-in space-y-4"
      data-testid="vault-foraging-container"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          icon={<ArrowLeft className="w-3.5 h-3.5" />}
          onClick={onBack}
          className="text-foreground hover:text-foreground/90"
        >
          {t.common.back}
        </Button>
        {forage.phase === "results" && forage.scanResult && (
          <span className="typo-body text-foreground">
            {tx(t.vault.foraging.scanned_sources, {
              count: forage.scanResult.scanned_sources.length,
              ms: forage.scanResult.scan_duration_ms,
            })}
          </span>
        )}
      </div>

      {/* Step indicator */}
      <ForagingStepIndicator phase={forage.phase} />

      {forage.phase === "idle" && <ForagingIdle onScan={forage.scan} />}

      {forage.phase === "scanning" && <ForagingScanning />}

      {forage.phase === "results" && forage.scanResult && (
        <ForagingResults forage={forage} importableCount={importableCount} onImport={handleImport} />
      )}

      {forage.phase === "importing" && <ForagingImporting forage={forage} />}

      {forage.phase === "done" && <ForagingDone forage={forage} onBack={onBack} />}

      {forage.phase === "error" && <ForagingError forage={forage} onBack={onBack} />}
    </div>
  );
}
