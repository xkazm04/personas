/**
 * CapabilityAddModal -- v3 capability-first layout.
 *
 * Opens when the user clicks "+ Add capability" on the capability list.
 * Captures title + summary + user-facing goal, then calls addCapabilityDraft
 * to inject a capability into the current session. The CLI refine path
 * (useMatrixLifecycle.handleRefine) then prompts the LLM to resolve the
 * full envelope for the new capability.
 */

import { useState, useCallback } from "react";
import { X } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";
import { useAgentStore } from "@/stores/agentStore";

interface Props {
  open: boolean;
  onClose: () => void;
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  // Fallback for emoji/punctuation-only titles: a timestamp-based suffix
  // ensures uniqueness without producing a bare "uc_" collision magnet.
  return `uc_${slug || `cap_${Date.now().toString(36)}`}`;
}

export function CapabilityAddModal({ open, onClose }: Props) {
  const { t } = useTranslation();
  const addCapabilityDraft = useAgentStore((s) => s.addCapabilityDraft);

  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [goal, setGoal] = useState("");

  const handleSubmit = useCallback(() => {
    if (!title.trim()) return;
    addCapabilityDraft({
      id: slugify(title),
      title: title.trim(),
      capability_summary: summary.trim(),
      user_facing_goal: goal.trim() || undefined,
    });
    setTitle("");
    setSummary("");
    setGoal("");
    onClose();
  }, [title, summary, goal, addCapabilityDraft, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      data-testid="capability-add-modal"
    >
      <div className="w-full max-w-lg rounded-2xl border border-border/40 bg-background shadow-xl">
        <header className="flex items-start justify-between border-b border-border/20 p-5">
          <div>
            <h2 className="typo-heading-sm text-foreground">
              {t.matrix_v3.add_capability_modal_title}
            </h2>
            <p className="mt-1 typo-body-sm text-foreground/60">
              {t.matrix_v3.add_capability_modal_subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-foreground/60 hover:bg-secondary/40 hover:text-foreground"
            aria-label={t.common.close}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1.5">
            <label className="typo-label text-foreground/80" htmlFor="cap-title">
              {t.matrix_v3.capability_title_label}
            </label>
            <input
              id="cap-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t.matrix_v3.add_capability_modal_title_placeholder}
              className="rounded-xl border border-border/40 bg-background/60 px-3 py-2 typo-body text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40"
              data-testid="capability-add-modal-title"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="typo-label text-foreground/80" htmlFor="cap-summary">
              {t.matrix_v3.capability_summary_label}
            </label>
            <textarea
              id="cap-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={2}
              placeholder={t.matrix_v3.add_capability_modal_summary_placeholder}
              className="rounded-xl border border-border/40 bg-background/60 px-3 py-2 typo-body text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40"
              data-testid="capability-add-modal-summary"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="typo-label text-foreground/80" htmlFor="cap-goal">
              {t.matrix_v3.capability_goal_label}
            </label>
            <input
              id="cap-goal"
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder={t.matrix_v3.add_capability_modal_goal_placeholder}
              className="rounded-xl border border-border/40 bg-background/60 px-3 py-2 typo-body text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40"
              data-testid="capability-add-modal-goal"
            />
          </div>
        </div>

        <footer className="flex justify-end gap-2 border-t border-border/20 p-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 typo-body-sm text-foreground/70 hover:bg-secondary/40"
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!title.trim()}
            className="rounded-xl bg-primary px-4 py-2 typo-body-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            data-testid="capability-add-modal-submit"
          >
            {t.matrix_v3.add_capability_modal_cta}
          </button>
        </footer>
      </div>
    </div>
  );
}
