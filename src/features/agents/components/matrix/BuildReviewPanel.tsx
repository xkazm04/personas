/**
 * Pre-promote review summary for the matrix creation flow.
 *
 * Shows agent identity, entity counts, connector readiness, and a
 * readiness checklist before the user promotes the draft to production.
 */
import { useMemo } from "react";
import {
  Wrench, Zap, Link2, MessageSquare, CheckCircle2, AlertTriangle,
  Shield, Brain, AlertOctagon, Calendar,
} from "lucide-react";
import { useAgentStore } from "@/stores/agentStore";
import { useMatrixCredentialGap } from "./useMatrixCredentialGap";
import { useTranslation } from '@/i18n/useTranslation';

interface BuildReviewPanelProps {
  onStartTest?: () => void;
  onPromote?: () => void;
  testPassed?: boolean | null;
  isTesting?: boolean;
}

export function BuildReviewPanel({
  onStartTest,
  onPromote,
  testPassed,
  isTesting,
}: BuildReviewPanelProps) {
  const { t } = useTranslation();
  const buildDraft = useAgentStore((s) => s.buildDraft) as Record<string, unknown> | null;
  const cellStates = useAgentStore((s) => s.buildCellStates);
  const cellData = useAgentStore((s) => s.buildCellData);
  const { hasCriticalGaps } = useMatrixCredentialGap();

  const counts = useMemo(() => {
    if (!buildDraft) return { tools: 0, triggers: 0, connectors: 0 };
    const tools = Array.isArray(buildDraft.tools) ? buildDraft.tools.length : 0;
    const triggers = Array.isArray(buildDraft.triggers) ? buildDraft.triggers.length : 0;
    const connectors = Array.isArray(buildDraft.required_connectors)
      ? (buildDraft.required_connectors as unknown[]).length
      : 0;
    return { tools, triggers, connectors };
  }, [buildDraft]);

  const agentName = (buildDraft?.name as string) ?? t.common.draft;
  const description = (buildDraft?.description as string) ?? "";
  const resolvedCount = Object.values(cellStates).filter((s) => s === "resolved" || s === "updated").length;
  const allResolved = resolvedCount >= 8;
  const hasPrompt = !!(buildDraft?.structured_prompt || buildDraft?.system_prompt);

  const checks = [
    { label: t.agents.build_review.agent_name, ok: agentName !== "Draft Agent" && agentName.length > 0 },
    { label: t.agents.build_review.all_dimensions, ok: allResolved },
    { label: t.agents.build_review.prompt_generated, ok: hasPrompt },
    { label: t.agents.build_review.connectors_ready, ok: !hasCriticalGaps },
  ];

  const allReady = checks.every((c) => c.ok);

  return (
    <div className="flex flex-col gap-3 w-full">
      {/* Agent identity */}
      <div className="text-center">
        <h3 className="text-sm font-semibold text-foreground/90 truncate">{agentName}</h3>
        {description && (
          <p className="text-[11px] text-muted-foreground/60 line-clamp-2 mt-0.5">{description}</p>
        )}
      </div>

      {/* Entity counts */}
      <div className="flex items-center justify-center gap-3 flex-wrap">
        <CountBadge icon={Wrench} count={counts.tools} label={t.common.tools} color="text-blue-400 bg-blue-500/10" />
        <CountBadge icon={Zap} count={counts.triggers} label={t.common.triggers} color="text-amber-400 bg-amber-500/10" />
        <CountBadge icon={Link2} count={counts.connectors} label={t.common.connectors} color="text-emerald-400 bg-emerald-500/10" />
      </div>

      {/* Readiness checklist */}
      <div className="space-y-1">
        {checks.map((check) => (
          <div key={check.label} className="flex items-center gap-2 text-[11px]">
            {check.ok ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
            )}
            <span className={check.ok ? "text-foreground/60" : "text-amber-400/80"}>{check.label}</span>
          </div>
        ))}
      </div>

      {/* Dimension summaries (compact) */}
      <div className="grid grid-cols-2 gap-1">
        <DimensionChip icon={Shield} label={t.agents.builder_preview.review} data={cellData["human-review"]} />
        <DimensionChip icon={Brain} label="Memory" data={cellData["memory"]} />
        <DimensionChip icon={MessageSquare} label="Messages" data={cellData["messages"]} />
        <DimensionChip icon={AlertOctagon} label={t.agents.builder_preview.errors} data={cellData["error-handling"]} />
        <DimensionChip icon={Calendar} label="Triggers" data={cellData["triggers"]} />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 mt-1">
        {testPassed === true ? (
          <button
            type="button"
            onClick={onPromote}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-card text-[11px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/25 transition-colors"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            {t.agents.build_review.promote_agent}
          </button>
        ) : (
          <button
            type="button"
            onClick={onStartTest}
            disabled={!allReady || isTesting}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-card text-[11px] font-medium bg-primary/15 text-primary border border-primary/20 hover:bg-primary/25 disabled:opacity-40 transition-colors"
          >
            {isTesting ? t.agents.build_review.testing : t.agents.build_review.test_agent}
          </button>
        )}
      </div>
    </div>
  );
}

function CountBadge({ icon: Icon, count, label, color }: {
  icon: typeof Wrench; count: number; label: string; color: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${color}`}>
      <Icon className="w-3 h-3" />
      {count} {label}
    </span>
  );
}

function DimensionChip({ icon: Icon, label, data }: {
  icon: typeof Shield; label: string; data?: { items?: string[]; summary?: string };
}) {
  const preview = data?.items?.[0] ?? data?.summary ?? "";
  const short = preview.length > 30 ? `${preview.slice(0, 30)}...` : preview;
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-secondary/20 min-w-0" title={preview}>
      <Icon className="w-3 h-3 text-muted-foreground/40 flex-shrink-0" />
      <span className="text-[10px] text-foreground/50 truncate">{label}: {short || "—"}</span>
    </div>
  );
}
