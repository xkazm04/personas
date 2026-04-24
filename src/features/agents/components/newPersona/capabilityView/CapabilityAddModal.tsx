import { useCallback, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";
import { useAgentStore } from "@/stores/agentStore";
import { slugify } from "./helpers";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface FieldRowProps {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  testId: string;
  optional?: boolean;
  optionalLabel?: string;
}

function FieldRow({
  id,
  label,
  placeholder,
  value,
  onChange,
  multiline,
  testId,
  optional,
  optionalLabel,
}: FieldRowProps) {
  const base =
    "w-full rounded-xl border border-border/40 bg-background/60 px-3 py-2 typo-body text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40";
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-2 typo-label text-foreground/80" htmlFor={id}>
        {label}
        {optional ? (
          <span className="typo-caption font-normal text-foreground/40">
            {optionalLabel}
          </span>
        ) : null}
      </label>
      {multiline ? (
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          placeholder={placeholder}
          className={base}
          data-testid={testId}
        />
      ) : (
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={base}
          data-testid={testId}
        />
      )}
    </div>
  );
}

export function CapabilityAddModal({ open, onClose }: Props) {
  const { t } = useTranslation();
  const addCapabilityDraft = useAgentStore((s) => s.addCapabilityDraft);

  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [goal, setGoal] = useState("");

  const reset = useCallback(() => {
    setTitle("");
    setSummary("");
    setGoal("");
  }, []);

  const handleSubmit = useCallback(() => {
    if (!title.trim()) return;
    addCapabilityDraft({
      id: slugify(title),
      title: title.trim(),
      capability_summary: summary.trim(),
      user_facing_goal: goal.trim() || undefined,
    });
    reset();
    onClose();
  }, [title, summary, goal, addCapabilityDraft, onClose, reset]);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      data-testid="capability-add-modal"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-border/40 bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border/20 p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary/15 p-2 text-primary">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h2 className="typo-heading-sm text-foreground">
                {t.matrix_v3.add_capability_modal_title}
              </h2>
              <p className="mt-1 typo-body-sm text-foreground/60">
                {t.matrix_v3.add_capability_modal_subtitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-full p-1.5 text-foreground/60 hover:bg-secondary/40 hover:text-foreground"
            aria-label={t.common.close}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex flex-col gap-4 p-5">
          <FieldRow
            id="cap-title"
            label={t.matrix_v3.capability_title_label}
            placeholder={t.matrix_v3.add_capability_modal_title_placeholder}
            value={title}
            onChange={setTitle}
            testId="capability-add-modal-title"
          />
          <FieldRow
            id="cap-summary"
            label={t.matrix_v3.capability_summary_label}
            placeholder={t.matrix_v3.add_capability_modal_summary_placeholder}
            value={summary}
            onChange={setSummary}
            multiline
            testId="capability-add-modal-summary"
          />
          <FieldRow
            id="cap-goal"
            label={t.matrix_v3.capability_goal_label}
            placeholder={t.matrix_v3.add_capability_modal_goal_placeholder}
            value={goal}
            onChange={setGoal}
            testId="capability-add-modal-goal"
            optional
            optionalLabel={t.common.optional}
          />
        </div>

        <footer className="flex justify-end gap-2 border-t border-border/20 p-4">
          <button
            type="button"
            onClick={handleClose}
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
