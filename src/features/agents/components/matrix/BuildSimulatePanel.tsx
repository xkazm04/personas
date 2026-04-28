/**
 * Dry-run preview panel for the build wizard.
 *
 * Lets the user pick one of the draft persona's capabilities, supply an
 * optional input override (defaults to the capability's `sample_input`),
 * and preview the actual agent output (manual reviews + memories) before
 * promoting the draft.
 *
 * Backend: `simulate_build_draft` + `get_simulation_artefacts`
 * (`src-tauri/src/commands/design/build_simulate.rs`).
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, Play, X } from "lucide-react";
import { BaseModal } from "@/lib/ui/BaseModal";
import { useTranslation } from "@/i18n/useTranslation";
import {
  getSimulationArtefacts,
  simulateBuildDraft,
  type SimulationArtefacts,
  type SimulatedExecution,
} from "@/api/agents/buildSession";
import { silentCatch } from "@/lib/silentCatch";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DraftUseCase {
  id: string;
  title: string;
  description?: string;
  sample_input?: unknown;
}

export interface BuildSimulatePanelProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string | null;
  /** The build session's draft.agent_ir — typed loosely because the IR shape
   * varies across template / matrix builds. We only read `use_cases[]`. */
  draft: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract use-case rows from a build draft IR. Tolerates both the v3
 * structured shape (objects with `id`/`title`/`sample_input`) and the
 * legacy simple shape (plain string descriptions).
 *
 * Pure: no React, no I/O. Exported for unit tests.
 */
export function extractUseCases(draft: unknown): DraftUseCase[] {
  if (!draft || typeof draft !== "object") return [];
  const root = draft as Record<string, unknown>;
  const candidates = (root.use_cases ?? root.useCases) as unknown;
  if (!Array.isArray(candidates)) return [];

  return candidates.map((uc, idx): DraftUseCase => {
    if (typeof uc === "string") {
      return {
        id: `uc_idx_${idx}`,
        title: uc.length > 60 ? `${uc.slice(0, 60)}…` : uc,
      };
    }
    if (uc && typeof uc === "object") {
      const obj = uc as Record<string, unknown>;
      const idRaw = obj.id;
      const titleRaw = obj.title;
      return {
        id: typeof idRaw === "string" && idRaw.trim().length > 0
          ? idRaw
          : `uc_idx_${idx}`,
        title: typeof titleRaw === "string" && titleRaw.trim().length > 0
          ? titleRaw
          : `Capability ${idx + 1}`,
        description: typeof obj.description === "string" ? obj.description : undefined,
        sample_input: obj.sample_input,
      };
    }
    return { id: `uc_idx_${idx}`, title: `Capability ${idx + 1}` };
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BuildSimulatePanel({
  isOpen,
  onClose,
  sessionId,
  draft,
}: BuildSimulatePanelProps) {
  const { t } = useTranslation();
  const useCases = useMemo(() => extractUseCases(draft), [draft]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inputOverride, setInputOverride] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [execution, setExecution] = useState<SimulatedExecution | null>(null);
  const [artefacts, setArtefacts] = useState<SimulationArtefacts | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Default-select the first capability when the modal opens or the draft changes.
  useEffect(() => {
    if (!isOpen || selectedId) return;
    const first = useCases[0];
    if (first) setSelectedId(first.id);
  }, [isOpen, useCases, selectedId]);

  // Reset transient state when modal closes.
  useEffect(() => {
    if (!isOpen) {
      setExecution(null);
      setArtefacts(null);
      setError(null);
      setInputOverride("");
      setSelectedId(null);
    }
  }, [isOpen]);

  const selectedUseCase = useMemo(
    () => useCases.find((u) => u.id === selectedId) ?? null,
    [useCases, selectedId],
  );

  const handleRun = async () => {
    if (!sessionId || !selectedId) return;
    setIsRunning(true);
    setError(null);
    setExecution(null);
    setArtefacts(null);

    try {
      const exec = await simulateBuildDraft(
        sessionId,
        selectedId,
        inputOverride.trim() || null,
      );
      setExecution(exec);

      const art = await getSimulationArtefacts(exec.id);
      setArtefacts(art);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      silentCatch("BuildSimulatePanel.handleRun")(e);
    } finally {
      setIsRunning(false);
    }
  };

  const samplePreview = useMemo(() => {
    const sample = selectedUseCase?.sample_input;
    if (sample === undefined || sample === null) return "";
    try {
      return JSON.stringify(sample, null, 2);
    } catch {
      return String(sample);
    }
  }, [selectedUseCase]);

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      titleId="build-simulate-title"
      size="lg"
      portal
    >
      <div className="bg-secondary/95 border border-border/40 rounded-modal shadow-elevation-3 overflow-hidden">
        <header className="flex items-start justify-between p-5 border-b border-border/30">
          <div>
            <h2
              id="build-simulate-title"
              className="typo-heading-md text-foreground"
            >
              {t.agents.build_simulate.title}
            </h2>
            <p className="typo-body-sm text-foreground/65 mt-1">
              {t.agents.build_simulate.subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.agents.build_simulate.close}
            className="text-foreground/60 hover:text-foreground p-1 rounded-interactive"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="p-5 space-y-4">
          {useCases.length === 0 ? (
            <p className="typo-body text-foreground/60">
              {t.agents.build_simulate.no_use_cases}
            </p>
          ) : (
            <>
              <label className="block">
                <span className="typo-label uppercase tracking-wide text-foreground/60 mb-1.5 block">
                  {t.agents.build_simulate.select_capability}
                </span>
                <select
                  data-testid="build-simulate-uc-select"
                  value={selectedId ?? ""}
                  onChange={(e) => setSelectedId(e.target.value)}
                  className="w-full bg-background/60 border border-border/40 rounded-input px-3 py-2 typo-body text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                >
                  {useCases.map((uc) => (
                    <option key={uc.id} value={uc.id}>
                      {uc.title}
                    </option>
                  ))}
                </select>
                {selectedUseCase?.description && (
                  <p className="typo-caption text-foreground/55 mt-1">
                    {selectedUseCase.description}
                  </p>
                )}
              </label>

              <label className="block">
                <span className="typo-label uppercase tracking-wide text-foreground/60 mb-1.5 block">
                  {t.agents.build_simulate.input_label}
                </span>
                <textarea
                  data-testid="build-simulate-input"
                  value={inputOverride}
                  onChange={(e) => setInputOverride(e.target.value)}
                  placeholder={
                    samplePreview ||
                    t.agents.build_simulate.input_placeholder
                  }
                  rows={4}
                  className="w-full bg-background/60 border border-border/40 rounded-input px-3 py-2 typo-body font-mono text-foreground/90 focus:outline-none focus:ring-1 focus:ring-primary/40"
                />
              </label>

              <div className="flex justify-end">
                <button
                  type="button"
                  data-testid="build-simulate-run"
                  onClick={() => void handleRun()}
                  disabled={isRunning || !selectedId || !sessionId}
                  className="px-4 py-2 rounded-interactive bg-primary/30 hover:bg-primary/45 disabled:opacity-50 disabled:cursor-not-allowed border border-primary/50 typo-body text-foreground flex items-center gap-2"
                >
                  {isRunning ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {t.agents.build_simulate.running}
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" />
                      {t.agents.build_simulate.run_button}
                    </>
                  )}
                </button>
              </div>

              {error && (
                <div
                  role="alert"
                  className="p-3 rounded-card border border-orange-400/40 bg-orange-500/10 typo-body-sm text-orange-200"
                >
                  <strong>{t.agents.build_simulate.error_label}:</strong>{" "}
                  {error}
                </div>
              )}

              {execution && (
                <ArtefactsPreview
                  execution={execution}
                  artefacts={artefacts}
                  noReviewsLabel={t.agents.build_simulate.no_reviews}
                  noMemoriesLabel={t.agents.build_simulate.no_memories}
                  reviewsHeading={t.agents.build_simulate.messages_section}
                  memoriesHeading={t.agents.build_simulate.memories_section}
                  artefactsTitleLabel={t.agents.build_simulate.artefacts_title}
                  executionLabel={t.agents.build_simulate.execution_id}
                  statusLabel={t.agents.build_simulate.status_label}
                  noArtefactsLabel={t.agents.build_simulate.no_artefacts}
                />
              )}
            </>
          )}
        </div>
      </div>
    </BaseModal>
  );
}

// ---------------------------------------------------------------------------
// Artefacts subview
// ---------------------------------------------------------------------------

interface ArtefactsPreviewProps {
  execution: SimulatedExecution;
  artefacts: SimulationArtefacts | null;
  reviewsHeading: string;
  memoriesHeading: string;
  noReviewsLabel: string;
  noMemoriesLabel: string;
  artefactsTitleLabel: string;
  executionLabel: string;
  statusLabel: string;
  noArtefactsLabel: string;
}

function ArtefactsPreview({
  execution,
  artefacts,
  reviewsHeading,
  memoriesHeading,
  noReviewsLabel,
  noMemoriesLabel,
  artefactsTitleLabel,
  executionLabel,
  statusLabel,
  noArtefactsLabel,
}: ArtefactsPreviewProps) {
  const reviews = artefacts?.reviews ?? [];
  const memories = artefacts?.memories ?? [];
  const isEmpty = reviews.length === 0 && memories.length === 0;

  return (
    <section
      data-testid="build-simulate-artefacts"
      className="border border-border/30 rounded-card p-4 bg-background/40"
    >
      <header className="mb-3 flex items-center justify-between">
        <h3 className="typo-heading-sm text-foreground">{artefactsTitleLabel}</h3>
        <div className="flex gap-3 typo-caption text-foreground/55">
          <span>
            {executionLabel}: <code>{execution.id.slice(0, 8)}…</code>
          </span>
          <span>
            {statusLabel}: <code>{execution.status}</code>
          </span>
        </div>
      </header>

      {isEmpty ? (
        <p className="typo-body text-foreground/55">{noArtefactsLabel}</p>
      ) : (
        <div className="space-y-4">
          <div>
            <h4 className="typo-label uppercase tracking-wide text-foreground/60 mb-2">
              {reviewsHeading}
            </h4>
            {reviews.length === 0 ? (
              <p className="typo-body-sm text-foreground/45">{noReviewsLabel}</p>
            ) : (
              <ul className="space-y-1.5">
                {reviews.map((r) => (
                  <li
                    key={r.id}
                    className="p-2 rounded-input bg-secondary/40 border border-border/20"
                  >
                    <div className="flex items-center gap-2">
                      <span className="typo-body-sm font-medium text-foreground">
                        {r.title}
                      </span>
                      <code className="typo-caption text-foreground/55">
                        {r.status}
                      </code>
                    </div>
                    {r.description && (
                      <p className="typo-caption text-foreground/65 mt-1 line-clamp-2">
                        {r.description}
                      </p>
                    )}
                    {r.reviewer_notes && (
                      <p className="typo-caption text-foreground/55 mt-1 italic">
                        {r.reviewer_notes}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h4 className="typo-label uppercase tracking-wide text-foreground/60 mb-2">
              {memoriesHeading}
            </h4>
            {memories.length === 0 ? (
              <p className="typo-body-sm text-foreground/45">{noMemoriesLabel}</p>
            ) : (
              <ul className="space-y-1.5">
                {memories.map((m) => (
                  <li
                    key={m.id}
                    className="p-2 rounded-input bg-secondary/40 border border-border/20"
                  >
                    <div className="flex items-center gap-2">
                      <span className="typo-body-sm font-medium text-foreground">
                        {m.title}
                      </span>
                      {m.category && (
                        <code className="typo-caption text-foreground/55">
                          {m.category}
                        </code>
                      )}
                    </div>
                    <p className="typo-caption text-foreground/65 mt-1 line-clamp-2">
                      {m.content}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
