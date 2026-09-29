/** ActFooters — the act-specific pieces of the action panel after the first
 *  pass: the draft's actions, the screening's live tail, the verdict's
 *  result and actions. The verdict never puts a force-promote one click away
 *  from a failed screening: it sits behind a confirm, and the primary action
 *  on failure is to refine. */
import { FlaskConical, Play, RefreshCw, Rocket, ScrollText, Layers, ThumbsDown } from "lucide-react";
import type { ToolTestResult } from "@/lib/types/buildTypes";
import { useTranslation } from "@/i18n/useTranslation";
import Button from "@/features/shared/components/buttons/Button";
import { Tooltip } from "@/features/shared/components/display/Tooltip";
import { GlyphPromotePreview } from "@/features/agents/sub_glyph/GlyphPromotePreview";
import type { PromoteView } from "@/features/agents/sub_glyph/promotePreviewModel";
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

/** What promote will do, above the verdict's actions. A refusal is shown in
 *  full (it is the reason Promote is disabled); the promotable detail (each
 *  trigger's first run, the connectors still needing setup, the build's
 *  repairs) sits one layer down in a disclosure, with the setup line lifted
 *  into its summary because it changes what the operator does next. */
export function VerdictPromotePreview({ view }: { view: PromoteView }) {
  const { t, tx } = useTranslation();
  const copy = t.agents.promote_preview;
  if (!view.hasContent) return null;
  if (!view.canPromote) return <GlyphPromotePreview view={view} />;
  return (
    <details className="group w-full min-w-0" data-testid="sheet-promote-preview">
      <summary className="cursor-pointer list-none typo-caption text-foreground [&::-webkit-details-marker]:hidden">
        <span className="underline decoration-dotted decoration-foreground/40 underline-offset-2 group-open:no-underline">{copy.heading}</span>
        {view.needsSetup.length > 0 && (
          <span className="text-status-warning">{" · "}{tx(copy.needs_setup, { connectors: view.needsSetup.join(", ") })}</span>
        )}
      </summary>
      <div className="mt-1.5 max-h-40 overflow-y-auto">
        <GlyphPromotePreview view={view} />
      </div>
    </details>
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
  /** Set when the promote preview says promote would refuse: Promote and
   *  Promote anyway are both disabled (as in the original Glyph approval,
   *  where one button carried both) with a tooltip naming the reason. */
  blockedReason?: string | null;
}

/** A disabled control cannot take hover or focus, so the tooltip naming the
 *  refusal needs a focusable trigger box. */
function Blocked({ reason, children }: { reason: string | null | undefined; children: React.ReactNode }) {
  const { t, tx } = useTranslation();
  if (reason == null) return <>{children}</>;
  return (
    <Tooltip triggerFocusable content={tx(t.agents.promote_preview.blocked_tooltip, { reason })}>
      {children}
    </Tooltip>
  );
}

export function VerdictActions({ passed, onPromote, onRefine, onReport, onReviewCaps, onSimulate, onAskForce, onAskReject, blockedReason }: VerdictActionsProps) {
  const blocked = blockedReason != null;
  return (
    <>
      {passed ? (
        <Blocked reason={blockedReason}>
          <Button
            variant="primary" size="md" icon={<Rocket className="w-3.5 h-3.5" />} onClick={onPromote}
            disabled={blocked} autoFocus={!blocked} data-testid="glyph-promote-button"
          >
            {COPY.promote} <Enter />
          </Button>
        </Blocked>
      ) : onRefine ? (
        <Button variant="primary" size="md" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={onRefine} autoFocus>{COPY.refine}</Button>
      ) : null}
      <Button variant="secondary" size="sm" icon={<ScrollText className="w-3.5 h-3.5" />} onClick={onReport} data-testid="build-test-report-open">{COPY.viewReport}</Button>
      {passed && onRefine && <Button variant="ghost" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={onRefine}>{COPY.refine}</Button>}
      <Button variant="ghost" size="sm" icon={<Layers className="w-3.5 h-3.5" />} onClick={onReviewCaps}>{COPY.reviewCaps}</Button>
      <SimulateButton onSimulate={onSimulate} />
      {!passed && onAskForce && (
        <Blocked reason={blockedReason}>
          <Button variant="link" size="sm" onClick={onAskForce} disabled={blocked} data-testid="sheet-promote-anyway">{COPY.promoteAnyway}</Button>
        </Blocked>
      )}
      {onAskReject && <Button variant="ghost" size="sm" icon={<ThumbsDown className="w-3.5 h-3.5" />} onClick={onAskReject}>{COPY.reject}</Button>}
    </>
  );
}

export { Enter };
