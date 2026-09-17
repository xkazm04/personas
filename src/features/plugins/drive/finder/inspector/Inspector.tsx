import { Info } from "lucide-react";

import ScenarioEmptyState from "@/features/shared/components/feedback/ScenarioEmptyState";
import { useTranslation } from "@/i18n/useTranslation";
import { visualForEntry } from "../../designTokens";
import type { InspectorProps } from "../types";
import { ActionsSection } from "./ActionsSection";
import { GeneralSection } from "./GeneralSection";
import { MultiSummary } from "./MultiSummary";
import { PreviewSection } from "./PreviewSection";
import { SignatureSection } from "./SignatureSection";
import { TagsSection } from "./TagsSection";

/**
 * Finder Inspector — the right-hand panel. Static chrome (header) always
 * renders; the body is an empty state, the single-entry sections, or the
 * multi-selection summary with tags applying to every selected entry.
 */
export function Inspector({
  entries,
  meta,
  signedPaths,
  onQuickLook,
  onOpen,
  onReveal,
  onSign,
  onVerify,
  onExtractText,
  hasGemini,
  onKnowledge,
  knowledgeAvailable,
}: InspectorProps) {
  const { t } = useTranslation();
  const f = t.plugins.drive.finder;
  const primary = entries[0] ?? null;
  const multi = entries.length > 1;

  let body: React.ReactNode;
  if (!primary) {
    body = (
      <ScenarioEmptyState
        icon={Info}
        title={f.insp_empty_title}
        subtitle={f.insp_empty_body}
        className="px-4"
      />
    );
  } else if (multi) {
    body = (
      <>
        <MultiSummary entries={entries} />
        <TagsSection entries={entries} meta={meta} />
      </>
    );
  } else {
    const visual = visualForEntry(primary);
    const Icon = visual.Icon;
    body = (
      <>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-card-border">
          <div className={`w-10 h-10 rounded-card border border-card-border flex items-center justify-center flex-shrink-0 bg-gradient-to-br ${visual.gradient}`}>
            <Icon className={`w-5 h-5 ${visual.text}`} />
          </div>
          <div className="typo-title-lg text-foreground break-all min-w-0">{primary.name}</div>
        </div>
        <PreviewSection entry={primary} onQuickLook={onQuickLook} />
        <GeneralSection entry={primary} />
        <TagsSection entries={entries} meta={meta} />
        <SignatureSection
          entry={primary}
          signed={signedPaths.has(primary.path)}
          onSign={onSign}
          onVerify={onVerify}
        />
        <ActionsSection
          entry={primary}
          onOpen={onOpen}
          onReveal={onReveal}
          onExtractText={onExtractText}
          hasGemini={hasGemini}
          onKnowledge={onKnowledge}
          knowledgeAvailable={knowledgeAvailable}
        />
      </>
    );
  }

  return (
    <aside
      data-testid="finder-inspector"
      aria-label={f.insp_title}
      className="h-full min-h-0 flex flex-col bg-card-bg border-l border-card-border overflow-hidden"
    >
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-card-border">
        <Info className="w-4 h-4 text-primary" />
        <h2 className="typo-title">{f.insp_title}</h2>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">{body}</div>
    </aside>
  );
}
