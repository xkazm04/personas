/** ActFooters — the lower third of the title card in each act after the
 *  first pass: wiring, draft, screening and the verdict. The verdict never
 *  puts a force-promote one click away from a failed screening: it sits
 *  behind a confirm, and the primary action on failure is to refine. */
import { FlaskConical, Play, RefreshCw, Rocket, ScrollText, Layers, ThumbsDown } from "lucide-react";
import type { ToolTestResult } from "@/lib/types/buildTypes";
import { useTranslation } from "@/i18n/useTranslation";
import Button from "@/features/shared/components/buttons/Button";
import { COPY } from "../copy";

export function Note({ children }: { children: React.ReactNode }) {
  return <span className="typo-body text-foreground max-w-[420px]">{children}</span>;
}

export function WiringFooter({ activity }: { activity: string | null }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="typo-body-lg text-foreground">{COPY.wiring}</span>
      <Note>{activity || COPY.wiringNote}</Note>
    </div>
  );
}

/** The dry-run (BuildSimulatePanel), reachable from the draft and the verdict. */
function SimulateButton({ onSimulate }: { onSimulate?: () => void }) {
  const { t } = useTranslation();
  return (
    <Button
      variant="ghost" size="sm" icon={<FlaskConical className="w-3.5 h-3.5" />}
      onClick={onSimulate} disabled={!onSimulate}
      data-testid="build-simulate-open"
    >
      {t.agents.build_simulate.open_button}
    </Button>
  );
}

interface DraftFooterProps {
  onStartTest: () => void | Promise<void>;
  onRefine?: () => void;
  onReviewCaps: () => void;
  /** Undefined while there is no build session to dry-run against. */
  onSimulate?: () => void;
}

export function DraftFooter({ onStartTest, onRefine, onReviewCaps, onSimulate }: DraftFooterProps) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <Button variant="primary" size="md" icon={<Play className="w-3.5 h-3.5" />} onClick={() => { void onStartTest(); }} autoFocus>
        {COPY.runTests} <kbd className="ml-1 font-mono typo-caption opacity-70">↵</kbd>
      </Button>
      <div className="flex items-center gap-1">
        {onRefine && <Button variant="ghost" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={onRefine}>{COPY.refine}</Button>}
        <Button variant="ghost" size="sm" icon={<Layers className="w-3.5 h-3.5" />} onClick={onReviewCaps}>{COPY.reviewCaps}</Button>
        <SimulateButton onSimulate={onSimulate} />
      </div>
    </div>
  );
}

export function ScreeningFooter({ lines }: { lines: string[] }) {
  const tail = lines.slice(-3);
  return (
    <div className="w-full max-w-[440px] flex flex-col items-center gap-1.5">
      <Button variant="primary" size="sm" loading loadingLabel={COPY.screening} disabled>{COPY.screening}</Button>
      {tail.length > 0 && (
        <div className="w-full rounded-card border border-card-border bg-background/70 px-3 py-1.5 text-left font-mono typo-caption text-foreground" aria-live="polite">
          {tail.map((l, i) => <div key={`${i}-${l}`} className="truncate">{l}</div>)}
        </div>
      )}
    </div>
  );
}

function ToolChips({ results }: { results: ToolTestResult[] }) {
  if (!results.length) return null;
  const tint = (s: ToolTestResult["status"]) => (s === "passed" ? "#34d399" : s === "failed" || s === "credential_missing" ? "#f87171" : "#fbbf24");
  return (
    <div className="flex flex-wrap justify-center gap-1.5 max-w-[460px]">
      {results.slice(0, 6).map((r) => (
        <span key={r.tool_name} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border typo-caption text-foreground" style={{ borderColor: `${tint(r.status)}66` }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: tint(r.status) }} />
          {r.tool_name}
        </span>
      ))}
      {results.length > 6 && <span className="typo-caption text-foreground">+{results.length - 6}</span>}
    </div>
  );
}

interface VerdictFooterProps {
  passed: boolean;
  testError: string | null | undefined;
  results: ToolTestResult[];
  onPromote: () => void;
  onRefine?: () => void;
  onReport: () => void;
  /** Remove / Split before promote. The container auto-starts the test on
   *  draft_ready, so the draft act is usually skipped and this is the only
   *  place the review is reachable; removals reach promote through the store's
   *  excludedCapabilityIds. */
  onReviewCaps: () => void;
  onSimulate?: () => void;
  onAskForce?: () => void;
  onAskReject?: () => void;
}

export function VerdictFooter({ passed, testError, results, onPromote, onRefine, onReport, onReviewCaps, onSimulate, onAskForce, onAskReject }: VerdictFooterProps) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="typo-body-lg font-semibold" style={{ color: passed ? "#34d399" : "#f87171" }}>{passed ? COPY.testsPassed : COPY.testsFailed}</span>
      {!passed && testError && <Note><span className="line-clamp-2">{testError}</span></Note>}
      <ToolChips results={results} />
      <div className="flex items-center gap-1.5 flex-wrap justify-center">
        {passed ? (
          <Button variant="primary" size="md" icon={<Rocket className="w-3.5 h-3.5" />} onClick={onPromote} autoFocus>
            {COPY.promote} <kbd className="ml-1 font-mono typo-caption opacity-70">↵</kbd>
          </Button>
        ) : onRefine ? (
          <Button variant="primary" size="md" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={onRefine} autoFocus>{COPY.refine}</Button>
        ) : null}
        <Button variant="secondary" size="sm" icon={<ScrollText className="w-3.5 h-3.5" />} onClick={onReport} data-testid="build-test-report-open">{COPY.viewReport}</Button>
        {passed && onRefine && <Button variant="ghost" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={onRefine}>{COPY.refine}</Button>}
      </div>
      <div className="flex items-center gap-1 flex-wrap justify-center">
        <Button variant="ghost" size="sm" icon={<Layers className="w-3.5 h-3.5" />} onClick={onReviewCaps}>{COPY.reviewCaps}</Button>
        <SimulateButton onSimulate={onSimulate} />
        {!passed && onAskForce && <Button variant="link" size="sm" onClick={onAskForce}>{COPY.promoteAnyway}</Button>}
        {onAskReject && <Button variant="ghost" size="sm" icon={<ThumbsDown className="w-3.5 h-3.5" />} onClick={onAskReject}>{COPY.reject}</Button>}
      </div>
    </div>
  );
}
