import { useCallback } from "react";
import {
  Radar,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  Download,
  Sparkles,
} from "lucide-react";
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useCredentialForaging } from "@/hooks/design/credential/useCredentialForaging";
import { ForagingResultCard } from "./ForagingResultCard";
import { ForagingStepIndicator } from "./ForagingStepIndicator";
import { Button } from "@/features/shared/components/buttons";

interface ForagingPanelProps {
  onComplete: () => void;
  onBack: () => void;
}

export function ForagingPanel({ onComplete, onBack }: ForagingPanelProps) {
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
          className="text-muted-foreground/70 hover:text-foreground/90"
        >
          Back
        </Button>
        {forage.phase === "results" && forage.scanResult && (
          <span className="text-sm text-muted-foreground/50">
            Scanned {forage.scanResult.scanned_sources.length} sources in{" "}
            {forage.scanResult.scan_duration_ms}ms
          </span>
        )}
      </div>

      {/* Step indicator */}
      <ForagingStepIndicator phase={forage.phase} />

      {/* Idle / Start state */}
      {forage.phase === "idle" && (
          <div
            key="idle"
            className="animate-fade-slide-in rounded-xl border border-primary/15 bg-secondary/25 p-6 text-center space-y-4"
          >
            <EmptyIllustration
              icon={Radar}
              heading="Credential Foraging"
              description="Scan your filesystem for existing credentials -- AWS profiles, environment variables, .env files, Docker configs, SSH keys, and more. Discovered credentials can be imported into your vault with one click."
            />
            <Button
              variant="accent"
              size="sm"
              icon={<Sparkles className="w-3.5 h-3.5" />}
              onClick={forage.scan}
              accentColor="violet"
              data-testid="vault-foraging-scan"
              className="bg-violet-500/15 text-violet-400 border-violet-500/25 hover:bg-violet-500/25"
            >
              Start Scan
            </Button>
            <div className="text-sm text-muted-foreground/60 space-y-0.5">
              <p>Scans: ~/.aws, ~/.kube, env vars, .env, ~/.npmrc, Docker, GitHub CLI, SSH</p>
              <p>No secrets are uploaded -- scanning happens entirely on your machine.</p>
            </div>
          </div>
        )}

        {/* Scanning */}
        {forage.phase === "scanning" && (
          <div
            key="scanning"
            className="animate-fade-slide-in rounded-xl border border-violet-500/20 bg-violet-500/5 p-8 text-center space-y-3"
          >
            <LoadingSpinner size="2xl" className="text-violet-400 mx-auto" />
            <p className="text-sm text-foreground/80">Scanning filesystem for credentials...</p>
            <p className="text-sm text-muted-foreground/50">
              Checking environment variables, config files, and dev tool credentials
            </p>
          </div>
        )}

        {/* Results */}
        {forage.phase === "results" && forage.scanResult && (
          <div
            key="results"
            className="animate-fade-slide-in space-y-3"
          >
            {/* Summary bar */}
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-foreground/80">
                  {forage.scanResult.credentials.length} credential
                  {forage.scanResult.credentials.length !== 1 ? "s" : ""} found
                </span>
                {importableCount > 0 && (
                  <span className="text-sm text-muted-foreground/50">
                    {forage.selected.size} selected
                  </span>
                )}
              </div>
              {importableCount > 0 && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="link"
                    size="sm"
                    onClick={forage.selectAll}
                    className="text-violet-400/80 hover:text-violet-400"
                  >
                    All
                  </Button>
                  <span className="text-muted-foreground/20">|</span>
                  <Button
                    variant="link"
                    size="sm"
                    onClick={forage.selectNone}
                    className="text-muted-foreground/50 hover:text-foreground/70"
                  >
                    None
                  </Button>
                </div>
              )}
            </div>

            {/* Empty state */}
            {forage.scanResult.credentials.length === 0 && (
              <div className="rounded-xl border border-primary/15 bg-secondary/25 p-6">
                <EmptyIllustration
                  icon={Radar}
                  heading="No credentials found"
                  description="Try setting environment variables like OPENAI_API_KEY or configure ~/.aws/credentials."
                />
              </div>
            )}

            {/* Credential cards */}
            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
              {forage.scanResult.credentials.map((cred) => (
                <ForagingResultCard
                  key={cred.id}
                  credential={cred}
                  isSelected={forage.selected.has(cred.id)}
                  isImporting={forage.importingIds.has(cred.id)}
                  isImported={forage.imported.has(cred.id)}
                  onToggle={() => forage.toggleSelect(cred.id)}
                />
              ))}
            </div>

            {/* Import button */}
            {forage.selected.size > 0 && (
              <Button
                variant="accent"
                size="md"
                icon={<Download className="w-4 h-4" />}
                block
                onClick={handleImport}
                accentColor="violet"
                className="bg-violet-500/15 text-violet-400 border-violet-500/25 hover:bg-violet-500/25"
              >
                Import {forage.selected.size} credential{forage.selected.size !== 1 ? "s" : ""} to vault
              </Button>
            )}
          </div>
        )}

        {/* Importing */}
        {forage.phase === "importing" && (
          <div
            key="importing"
            className="animate-fade-slide-in space-y-3"
          >
            <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 text-center space-y-2">
              <LoadingSpinner size="xl" className="text-violet-400 mx-auto" />
              <p className="text-sm text-foreground/80">
                Importing credentials to vault...
              </p>
              <p className="text-sm text-muted-foreground/50">
                {forage.imported.size} of {forage.selected.size} complete
              </p>
            </div>
            {/* Show cards with importing state */}
            {forage.scanResult && (
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                {forage.scanResult.credentials
                  .filter((c) => forage.selected.has(c.id))
                  .map((cred) => (
                    <ForagingResultCard
                      key={cred.id}
                      credential={cred}
                      isSelected={true}
                      isImporting={forage.importingIds.has(cred.id)}
                      isImported={forage.imported.has(cred.id)}
                      onToggle={() => {}}
                    />
                  ))}
              </div>
            )}
          </div>
        )}

        {/* Done */}
        {forage.phase === "done" && (
          <div
            key="done"
            className="animate-fade-slide-in rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-6 text-center space-y-3"
          >
            <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
            <div>
              <p className="text-sm font-medium text-foreground/90">
                {forage.imported.size} credential{forage.imported.size !== 1 ? "s" : ""} imported
              </p>
              {forage.error && (
                <p className="text-sm text-amber-400/80 mt-1">{forage.error}</p>
              )}
            </div>
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="link"
                size="sm"
                onClick={forage.scan}
                className="text-muted-foreground/60 hover:text-foreground/80"
              >
                Scan again
              </Button>
              <span className="text-muted-foreground/20">|</span>
              <Button
                variant="link"
                size="sm"
                onClick={onBack}
                className="text-violet-400/80 hover:text-violet-400"
              >
                Back to vault
              </Button>
            </div>
          </div>
        )}

        {/* Error */}
        {forage.phase === "error" && (
          <div
            key="error"
            className="animate-fade-slide-in rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-center space-y-3"
          >
            <AlertTriangle className="w-8 h-8 text-red-400 mx-auto" />
            <div>
              <p className="text-sm font-medium text-foreground/90">Scan Failed</p>
              <p className="text-sm text-red-400/70 mt-1">{forage.error}</p>
            </div>
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="link"
                size="sm"
                onClick={forage.scan}
                className="text-violet-400/80 hover:text-violet-400"
              >
                Try again
              </Button>
              <span className="text-muted-foreground/20">|</span>
              <Button
                variant="link"
                size="sm"
                onClick={onBack}
                className="text-muted-foreground/60 hover:text-foreground/80"
              >
                Back
              </Button>
            </div>
          </div>
        )}
    </div>
  );
}
