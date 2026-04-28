/**
 * Reference attachment picker — surfaced inside `SpatialQuestionPopover`
 * when the pending question carries `acceptsReference: true`.
 *
 * Three modes (mutually exclusive — once one is chosen, the others are
 * hidden until the user clears it):
 *   - File: native dialog via `@tauri-apps/plugin-dialog::open()`
 *   - URL: HTTPS URL input (server-side SSRF-safe fetch)
 *   - Inline: plain textarea paste
 *
 * Selected reference shows as a chip with a clear button. On submit, the
 * parent component bundles `{ path | url | inlineContent, name }` into the
 * `BuildReference` payload sent to `answer_build_question`.
 */
import { useState, useCallback } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { File, Globe, Paperclip, Pencil, X } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";
import type { BuildReference } from "@/lib/types/buildTypes";
import { silentCatch } from "@/lib/silentCatch";

const TEXT_EXTENSIONS = [
  "txt", "md", "markdown", "json", "yaml", "yml", "toml", "csv", "tsv",
  "html", "htm", "xml", "log", "ini", "conf", "cfg", "rst", "tex",
  "ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "rb", "php", "sh",
  "sql", "graphql", "proto",
];

interface ReferenceAttachmentPickerProps {
  value: BuildReference | null;
  onChange: (next: BuildReference | null) => void;
}

type PickerMode = "idle" | "url" | "inline";

export function ReferenceAttachmentPicker({
  value,
  onChange,
}: ReferenceAttachmentPickerProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<PickerMode>("idle");
  const [urlText, setUrlText] = useState("");
  const [inlineText, setInlineText] = useState("");

  const handlePickFile = useCallback(async () => {
    try {
      const picked = await openDialog({
        multiple: false,
        filters: [{ name: "Text reference", extensions: TEXT_EXTENSIONS }],
      });
      if (!picked) return;
      const path = typeof picked === "string" ? picked : String(picked);
      // Extract a friendly basename for the chip (best-effort cross-platform).
      const sep = path.includes("\\") ? "\\" : "/";
      const name = path.split(sep).pop() || path;
      onChange({ path, name });
      setMode("idle");
    } catch (e) {
      silentCatch("ReferenceAttachmentPicker.handlePickFile")(e);
    }
  }, [onChange]);

  const handleSubmitUrl = useCallback(() => {
    const trimmed = urlText.trim();
    if (!trimmed) return;
    onChange({ url: trimmed, name: trimmed });
    setUrlText("");
    setMode("idle");
  }, [urlText, onChange]);

  const handleSubmitInline = useCallback(() => {
    const trimmed = inlineText.trim();
    if (!trimmed) return;
    onChange({
      inlineContent: trimmed,
      name: t.agents.build_reference.pasted_name,
    });
    setInlineText("");
    setMode("idle");
  }, [inlineText, onChange, t.agents.build_reference.pasted_name]);

  // ---- Selected — render chip ------------------------------------------------
  if (value) {
    const kind: "file" | "url" | "inline" = value.path
      ? "file"
      : value.url
        ? "url"
        : "inline";
    const Icon = kind === "file" ? File : kind === "url" ? Globe : Pencil;
    const label = value.name ?? value.path ?? value.url ?? "(reference)";
    return (
      <div
        data-testid="reference-attachment-chip"
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-input bg-primary/10 border border-primary/20 typo-caption text-foreground/90"
      >
        <Icon className="w-3.5 h-3.5 text-primary/80" />
        <span className="truncate max-w-[260px]" title={label}>
          {label}
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label={t.agents.build_reference.clear}
          className="text-foreground/55 hover:text-foreground p-0.5 rounded-interactive"
          data-testid="reference-attachment-clear"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  }

  // ---- Idle — three CTA buttons ---------------------------------------------
  if (mode === "idle") {
    return (
      <div
        data-testid="reference-attachment-cta"
        className="flex items-center gap-1.5 flex-wrap"
      >
        <span className="typo-caption text-foreground/55 mr-1 inline-flex items-center gap-1">
          <Paperclip className="w-3 h-3" />
          {t.agents.build_reference.attach_label}:
        </span>
        <button
          type="button"
          data-testid="reference-attach-file"
          onClick={() => void handlePickFile()}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-interactive bg-foreground/5 hover:bg-foreground/10 border border-border/30 typo-caption text-foreground/80"
        >
          <File className="w-3 h-3" />
          {t.agents.build_reference.file_button}
        </button>
        <button
          type="button"
          data-testid="reference-attach-url"
          onClick={() => setMode("url")}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-interactive bg-foreground/5 hover:bg-foreground/10 border border-border/30 typo-caption text-foreground/80"
        >
          <Globe className="w-3 h-3" />
          {t.agents.build_reference.url_button}
        </button>
        <button
          type="button"
          data-testid="reference-attach-inline"
          onClick={() => setMode("inline")}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-interactive bg-foreground/5 hover:bg-foreground/10 border border-border/30 typo-caption text-foreground/80"
        >
          <Pencil className="w-3 h-3" />
          {t.agents.build_reference.inline_button}
        </button>
      </div>
    );
  }

  // ---- URL mode --------------------------------------------------------------
  if (mode === "url") {
    return (
      <div
        data-testid="reference-attachment-url-form"
        className="flex flex-col gap-2 p-3 rounded-card border border-border/30 bg-background/40"
      >
        <label className="typo-caption text-foreground/65">
          {t.agents.build_reference.url_input_label}
        </label>
        <input
          type="url"
          autoFocus
          data-testid="reference-attachment-url-input"
          value={urlText}
          onChange={(e) => setUrlText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSubmitUrl();
            }
            if (e.key === "Escape") setMode("idle");
          }}
          placeholder="https://example.com/spec.json"
          className="w-full bg-background/60 border border-border/40 rounded-input px-3 py-1.5 typo-body-sm text-foreground/90 focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => setMode("idle")}
            className="px-2.5 py-1 typo-caption text-foreground/65 hover:text-foreground"
          >
            {t.agents.build_reference.cancel}
          </button>
          <button
            type="button"
            data-testid="reference-attachment-url-submit"
            onClick={handleSubmitUrl}
            disabled={!urlText.trim()}
            className="px-2.5 py-1 rounded-interactive bg-primary/25 hover:bg-primary/40 disabled:opacity-50 border border-primary/40 typo-caption text-foreground"
          >
            {t.agents.build_reference.attach_button}
          </button>
        </div>
      </div>
    );
  }

  // ---- Inline-paste mode -----------------------------------------------------
  return (
    <div
      data-testid="reference-attachment-inline-form"
      className="flex flex-col gap-2 p-3 rounded-card border border-border/30 bg-background/40"
    >
      <label className="typo-caption text-foreground/65">
        {t.agents.build_reference.inline_input_label}
      </label>
      <textarea
        autoFocus
        rows={4}
        data-testid="reference-attachment-inline-input"
        value={inlineText}
        onChange={(e) => setInlineText(e.target.value)}
        placeholder={t.agents.build_reference.inline_placeholder}
        className="w-full bg-background/60 border border-border/40 rounded-input px-3 py-1.5 typo-body-sm font-mono text-foreground/90 focus:outline-none focus:ring-1 focus:ring-primary/40"
      />
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={() => setMode("idle")}
          className="px-2.5 py-1 typo-caption text-foreground/65 hover:text-foreground"
        >
          {t.agents.build_reference.cancel}
        </button>
        <button
          type="button"
          data-testid="reference-attachment-inline-submit"
          onClick={handleSubmitInline}
          disabled={!inlineText.trim()}
          className="px-2.5 py-1 rounded-interactive bg-primary/25 hover:bg-primary/40 disabled:opacity-50 border border-primary/40 typo-caption text-foreground"
        >
          {t.agents.build_reference.attach_button}
        </button>
      </div>
    </div>
  );
}
