/** ActFooters — the act-specific pieces of the action panel after the first
 *  pass: the draft's actions, the screening's live tail, the verdict's
 *  result and actions. The verdict never puts a force-promote one click away
 *  from a failed screening: it sits behind a confirm, and the primary action
 *  on failure is to refine. */
import { FlaskConical, Play, RefreshCw, Rocket, ScrollText, Layers, ThumbsDown } from "lucide-react";
import type { ToolTestResult } from "@/lib/types/buildTypes";
import { useTranslation } from "@/i18n/useTranslation";
import Button from "@/features/shared/components/buttons/Button";
import { COPY } from "../copy";

export function Note({ children }: { children: React.ReactNode }) {
  return <span className="typo-body text-foreground">{children}</span>;
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

const Enter = () => <kbd className="ml-1 font-mono typo-caption opacity-70">↵</kbd>;

interface DraftActionsProps {
  onStartTest: () => void | Promise<void>;
  onRefine?: () => void;
  onReviewCaps: () => void;
  /** Undefined while there is no build session to dry-run against. */
  onSimulate?: () => void;
}

export function DraftActions({ onStartTest, onRefine, onReviewCaps, onSimulate }: DraftActionsProps) {
  return (
    <>
      <Button variant="primary" size="md" icon={<Play className="w-3.5 h-3.5" />} onClick={() => { void onStartTest(); }} autoFocus>
        {COPY.runTests} <Enter />
      </Button>
      {onRefine && <Button variant="ghost" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={onRefine}>{COPY.refine}</Button>}
      <Button variant="ghost" size="sm" icon={<Layers className="w-3.5 h-3.5" />} onClick={onReviewCaps}>{COPY.reviewCaps}</Button>
      <SimulateButton onSimulate={onSimulate} />
    </>
  );
}

export function ScreeningBody({ lines }: { lines: string[] }) {
  const tail = lines.slice(-3);
  // The live region stays mounted so the first lines are announced too.
  return (
    <div className="w-full" aria-live="polite">
      {tail.length > 0 && (
        <div className="w-full rounded-input border border-card-border bg-background/60 px-3 py-1.5 font-mono typo-caption text-foreground">
          {tail.map((l, i) => <div key={`${i}-${l}`} className="truncate">{l}</div>)}
        </div>
      )}
    </div>
  );
}

const TINT: Record<ToolTestResult["status"], string> = {
  passed: "var(--status-success)",
  failed: "var(--status-error)",
  credential_missing: "var(--status-error)",
  skipped: "var(--status-warning)",
  unverified: "var(--status-warning)",
};

function ToolChips({ results }: { results: ToolTestResult[] }) {
  if (!results.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {results.slice(0, 6).map((r) => {
        const tint = TINT[r.status];
        return (
          <span key={r.tool_name} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-card-border bg-background/50 typo-caption text-foreground">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: tint }} />
            {r.tool_name}
          </span>
        );
      })}
      {results.length > 6 && <span className="typo-caption text-foreground">+{results.length - 6}</span>}
    </div>
  );
}

export function VerdictBody({ passed, testError, results }: { passed: boolean; testError: string | null | undefined; results: ToolTestResult[] }) {
  if (passed && !results.length) return null;
  return (
    <>
      {!passed && testError && <Note><span className="line-clamp-2">{testError}</span></Note>}
      <ToolChips results={results} />
    </>
  );
}

interface VerdictActionsProps {
  passed: boolean;
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

export function VerdictActions({ passed, onPromote, onRefine, onReport, onReviewCaps, onSimulate, onAskForce, onAskReject }: VerdictActionsProps) {
  return (
    <>
      {passed ? (
        <Button variant="primary" size="md" icon={<Rocket className="w-3.5 h-3.5" />} onClick={onPromote} autoFocus>
          {COPY.promote} <Enter />
        </Button>
      ) : onRefine ? (
        <Button variant="primary" size="md" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={onRefine} autoFocus>{COPY.refine}</Button>
      ) : null}
      <Button variant="secondary" size="sm" icon={<ScrollText className="w-3.5 h-3.5" />} onClick={onReport} data-testid="build-test-report-open">{COPY.viewReport}</Button>
      {passed && onRefine && <Button variant="ghost" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={onRefine}>{COPY.refine}</Button>}
      <Button variant="ghost" size="sm" icon={<Layers className="w-3.5 h-3.5" />} onClick={onReviewCaps}>{COPY.reviewCaps}</Button>
      <SimulateButton onSimulate={onSimulate} />
      {!passed && onAskForce && <Button variant="link" size="sm" onClick={onAskForce}>{COPY.promoteAnyway}</Button>}
      {onAskReject && <Button variant="ghost" size="sm" icon={<ThumbsDown className="w-3.5 h-3.5" />} onClick={onAskReject}>{COPY.reject}</Button>}
    </>
  );
}

export { Enter };
