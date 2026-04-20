/**
 * BehaviorCoreEditor -- v3 capability framework top band.
 *
 * Renders the persona's Mission + Identity + Voice + Principles + Constraints
 * as an editable card. Reads from `buildBehaviorCore` and mutates via
 * `patchBehaviorCore`. See §3.2 + §9 of
 * docs/concepts/persona-capabilities/C4-build-from-scratch-v3-handoff.md.
 *
 * The mission editor enforces the "mission is not a task" rule via inline
 * coaching: task verbs (fetch/send/check/query/scan/monitor/poll) trigger a
 * red-highlighted warning; purpose verbs (be/make/ensure/serve/guard/protect)
 * trigger a green confirmation.
 */

import { useCallback, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAgentStore } from "@/stores/agentStore";
import { useTranslation } from "@/i18n/useTranslation";
import type { PersonaBehaviorCore } from "@/lib/types/buildTypes";

const TASK_VERBS = [
  "fetch", "send", "check", "query", "scan", "monitor", "poll", "read",
  "get", "post", "pull", "push", "download", "upload",
];
const PURPOSE_VERBS = [
  "be", "make", "ensure", "serve", "guard", "protect", "keep", "help",
  "give", "enable", "empower",
];

function classifyMission(mission: string): "empty" | "task" | "purpose" | "neutral" {
  const trimmed = mission.trim().toLowerCase();
  if (trimmed.length === 0) return "empty";
  const firstWord = trimmed.split(/\s+/)[0] ?? "";
  if (PURPOSE_VERBS.includes(firstWord)) return "purpose";
  if (TASK_VERBS.includes(firstWord)) return "task";
  return "neutral";
}

interface ChipListEditorProps {
  label: string;
  helperText?: string;
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => void;
  testId: string;
}

function ChipListEditor({
  label,
  helperText,
  placeholder,
  values,
  onChange,
  testId,
}: ChipListEditorProps) {
  const [draft, setDraft] = useState("");

  const addChip = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onChange([...values, trimmed]);
    setDraft("");
  }, [draft, values, onChange]);

  const removeChip = useCallback(
    (i: number) => {
      onChange(values.filter((_, idx) => idx !== i));
    },
    [values, onChange],
  );

  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <label className="typo-label text-foreground/80">{label}</label>
      {helperText ? (
        <p className="typo-caption text-foreground/50">{helperText}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {values.map((v, i) => (
          <span
            key={`${v}-${i}`}
            className="inline-flex items-center gap-1.5 rounded-full bg-secondary/40 px-3 py-1 typo-body-sm text-foreground"
          >
            {v}
            <button
              type="button"
              onClick={() => removeChip(i)}
              className="text-foreground/50 hover:text-foreground"
              aria-label="Remove"
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addChip();
            }
          }}
          onBlur={addChip}
          placeholder={placeholder}
          className="min-w-[160px] flex-1 rounded-full border border-border/40 bg-transparent px-3 py-1 typo-body-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/50"
          data-testid={`${testId}-input`}
        />
      </div>
    </div>
  );
}

export function BehaviorCoreEditor() {
  const { t } = useTranslation();
  const { core, patchBehaviorCore } = useAgentStore(
    useShallow((s) => ({
      core: s.buildBehaviorCore,
      patchBehaviorCore: s.patchBehaviorCore,
    })),
  );

  const missionClass = useMemo(
    () => classifyMission(core?.mission ?? ""),
    [core?.mission],
  );

  const coreSafe: PersonaBehaviorCore = core ?? {
    mission: "",
    identity: { role: "", description: "" },
    voice: { style: "", output_format: "" },
    principles: [],
    constraints: [],
  };

  const missionHintText =
    missionClass === "task"
      ? t.matrix_v3.mission_coach_task_warning
      : missionClass === "purpose"
        ? t.matrix_v3.mission_coach_good
        : t.matrix_v3.mission_helper_text;
  const missionHintClass =
    missionClass === "task"
      ? "text-red-500"
      : missionClass === "purpose"
        ? "text-emerald-500"
        : "text-foreground/50";

  return (
    <section
      className="flex flex-col gap-5 rounded-2xl border border-border/30 bg-secondary/10 p-5"
      data-testid="behavior-core-editor"
    >
      <header className="flex flex-col gap-1">
        <h3 className="typo-heading-sm text-foreground">
          {t.matrix_v3.behavior_core_section_title}
        </h3>
        <p className="typo-body-sm text-foreground/50">
          {t.matrix_v3.behavior_core_section_subtitle}
        </p>
      </header>

      {/* Mission */}
      <div className="flex flex-col gap-2" data-testid="behavior-core-mission">
        <label className="typo-label text-foreground/80" htmlFor="bc-mission">
          {t.matrix_v3.mission_label}
        </label>
        <textarea
          id="bc-mission"
          value={coreSafe.mission}
          onChange={(e) => patchBehaviorCore({ mission: e.target.value })}
          placeholder={t.matrix_v3.mission_placeholder}
          rows={2}
          className="w-full rounded-xl border border-border/40 bg-background/60 px-3 py-2 typo-body text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40"
          data-testid="behavior-core-mission-input"
        />
        <p className={`typo-caption ${missionHintClass}`} data-testid="behavior-core-mission-hint">
          {missionHintText}
        </p>
      </div>

      {/* Identity */}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-2" data-testid="behavior-core-identity-role">
          <label className="typo-label text-foreground/80" htmlFor="bc-identity-role">
            {t.matrix_v3.identity_role_label}
          </label>
          <input
            id="bc-identity-role"
            type="text"
            value={coreSafe.identity.role}
            onChange={(e) =>
              patchBehaviorCore({ identity: { ...coreSafe.identity, role: e.target.value } })
            }
            placeholder={t.matrix_v3.identity_role_placeholder}
            className="rounded-xl border border-border/40 bg-background/60 px-3 py-2 typo-body-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div className="flex flex-col gap-2" data-testid="behavior-core-identity-description">
          <label
            className="typo-label text-foreground/80"
            htmlFor="bc-identity-description"
          >
            {t.matrix_v3.identity_description_label}
          </label>
          <input
            id="bc-identity-description"
            type="text"
            value={coreSafe.identity.description}
            onChange={(e) =>
              patchBehaviorCore({
                identity: { ...coreSafe.identity, description: e.target.value },
              })
            }
            placeholder={t.matrix_v3.identity_description_placeholder}
            className="rounded-xl border border-border/40 bg-background/60 px-3 py-2 typo-body-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
      </div>

      {/* Voice */}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-2" data-testid="behavior-core-voice-style">
          <label className="typo-label text-foreground/80" htmlFor="bc-voice-style">
            {t.matrix_v3.voice_style_label}
          </label>
          <input
            id="bc-voice-style"
            type="text"
            value={coreSafe.voice.style}
            onChange={(e) =>
              patchBehaviorCore({ voice: { ...coreSafe.voice, style: e.target.value } })
            }
            placeholder={t.matrix_v3.voice_style_placeholder}
            className="rounded-xl border border-border/40 bg-background/60 px-3 py-2 typo-body-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div className="flex flex-col gap-2" data-testid="behavior-core-voice-output-format">
          <label className="typo-label text-foreground/80" htmlFor="bc-voice-output-format">
            {t.matrix_v3.voice_output_format_label}
          </label>
          <input
            id="bc-voice-output-format"
            type="text"
            value={coreSafe.voice.output_format}
            onChange={(e) =>
              patchBehaviorCore({
                voice: { ...coreSafe.voice, output_format: e.target.value },
              })
            }
            placeholder={t.matrix_v3.voice_output_format_placeholder}
            className="rounded-xl border border-border/40 bg-background/60 px-3 py-2 typo-body-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
      </div>

      {/* Principles */}
      <ChipListEditor
        label={t.matrix_v3.principles_label}
        helperText={t.matrix_v3.principles_helper_text}
        placeholder={t.matrix_v3.principles_add_placeholder}
        values={coreSafe.principles}
        onChange={(next) => patchBehaviorCore({ principles: next })}
        testId="behavior-core-principles"
      />

      {/* Constraints */}
      <ChipListEditor
        label={t.matrix_v3.constraints_label}
        helperText={t.matrix_v3.constraints_helper_text}
        placeholder={t.matrix_v3.constraints_add_placeholder}
        values={coreSafe.constraints}
        onChange={(next) => patchBehaviorCore({ constraints: next })}
        testId="behavior-core-constraints"
      />

      {/* Decision principles (optional) */}
      {(coreSafe.decision_principles?.length ?? 0) > 0 ? (
        <ChipListEditor
          label={t.matrix_v3.decision_principles_label}
          helperText={t.matrix_v3.decision_principles_helper_text}
          placeholder={t.matrix_v3.decision_principles_add_placeholder}
          values={coreSafe.decision_principles ?? []}
          onChange={(next) => patchBehaviorCore({ decision_principles: next })}
          testId="behavior-core-decision-principles"
        />
      ) : null}
    </section>
  );
}
