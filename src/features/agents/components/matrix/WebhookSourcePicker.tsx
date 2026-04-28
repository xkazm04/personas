/**
 * Webhook source picker — surfaced inside `SpatialQuestionPopover` when the
 * pending question carries `acceptsWebhookSource: true` (build prompt rule
 * 24, emitted when the LLM picks `webhook` trigger type for a capability).
 *
 * UX:
 *   - smee.io URL input with format validation (`https://smee.io/...`)
 *   - Optional comma-separated event_type filter
 *   - "Don't have one? Create at smee.io/new" external link button
 *   - Selected source renders as a chip with clear button
 *
 * Submitting bundles the value into `BuildWebhookSource` which the answer
 * command appends as a fenced WEBHOOK SOURCE block to the answer text. The
 * LLM places the URL on the trigger config; promote-time auto-creates a
 * `smee_relays` row pointing at the new persona.
 */
import { useState, useCallback } from "react";
import { ExternalLink, Globe, X, Webhook } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";
import type { BuildWebhookSource } from "@/lib/types/buildTypes";
import { openExternalUrl } from "@/api/system/system";
import { silentCatch } from "@/lib/silentCatch";

const SMEE_URL_PREFIX = "https://smee.io/";

interface WebhookSourcePickerProps {
  value: BuildWebhookSource | null;
  onChange: (next: BuildWebhookSource | null) => void;
}

export function WebhookSourcePicker({ value, onChange }: WebhookSourcePickerProps) {
  const { t } = useTranslation();
  const [urlText, setUrlText] = useState("");
  const [filterText, setFilterText] = useState("");
  const [touched, setTouched] = useState(false);

  const trimmedUrl = urlText.trim();
  const isValidUrl =
    trimmedUrl.length > SMEE_URL_PREFIX.length &&
    trimmedUrl.startsWith(SMEE_URL_PREFIX);
  const showError = touched && trimmedUrl.length > 0 && !isValidUrl;

  const handleSubmit = useCallback(() => {
    setTouched(true);
    if (!isValidUrl) return;
    const filter = filterText.trim();
    onChange({
      channelUrl: trimmedUrl,
      eventFilter: filter.length > 0 ? filter : undefined,
    });
    setUrlText("");
    setFilterText("");
    setTouched(false);
  }, [isValidUrl, trimmedUrl, filterText, onChange]);

  const handleOpenSmeeNew = useCallback(() => {
    openExternalUrl("https://smee.io/new").catch(
      silentCatch("WebhookSourcePicker.handleOpenSmeeNew"),
    );
  }, []);

  // ---- Selected — render chip ------------------------------------------------
  if (value) {
    return (
      <div
        data-testid="webhook-source-chip"
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-input bg-primary/10 border border-primary/20 typo-caption text-foreground/90"
      >
        <Webhook className="w-3.5 h-3.5 text-primary/80" />
        <span className="truncate max-w-[260px]" title={value.channelUrl}>
          <span className="text-foreground/55 mr-1">
            {t.agents.build_webhook_source.chip_label}:
          </span>
          {value.channelUrl}
          {value.eventFilter && (
            <span className="text-foreground/55 ml-1">[{value.eventFilter}]</span>
          )}
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label={t.agents.build_webhook_source.clear}
          className="text-foreground/55 hover:text-foreground p-0.5 rounded-interactive"
          data-testid="webhook-source-clear"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    );
  }

  // ---- Form ------------------------------------------------------------------
  return (
    <div
      data-testid="webhook-source-form"
      className="flex flex-col gap-2 p-3 rounded-card border border-border/30 bg-background/40"
    >
      <header className="flex items-center justify-between gap-2">
        <div>
          <h4 className="typo-label uppercase tracking-wide text-foreground/65 inline-flex items-center gap-1.5">
            <Webhook className="w-3 h-3" />
            {t.agents.build_webhook_source.header}
          </h4>
          <p className="typo-caption text-foreground/55 mt-0.5">
            {t.agents.build_webhook_source.description}
          </p>
        </div>
        <button
          type="button"
          data-testid="webhook-source-create-channel"
          onClick={handleOpenSmeeNew}
          className="inline-flex items-center gap-1 typo-caption text-primary/80 hover:text-primary"
        >
          <ExternalLink className="w-3 h-3" />
          {t.agents.build_webhook_source.create_channel}
        </button>
      </header>

      <label className="flex flex-col gap-1">
        <span className="typo-caption text-foreground/65">
          {t.agents.build_webhook_source.url_label}
        </span>
        <input
          type="url"
          autoFocus
          data-testid="webhook-source-url-input"
          value={urlText}
          onChange={(e) => setUrlText(e.target.value)}
          onBlur={() => setTouched(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder={t.agents.build_webhook_source.url_placeholder}
          className={`w-full bg-background/60 border rounded-input px-3 py-1.5 typo-body-sm text-foreground/90 focus:outline-none focus:ring-1 focus:ring-primary/40 ${showError ? "border-orange-400/60" : "border-border/40"}`}
        />
        {showError && (
          <span
            data-testid="webhook-source-url-error"
            className="typo-caption text-orange-300"
          >
            <Globe className="w-3 h-3 inline mr-1" />
            {t.agents.build_webhook_source.url_invalid}
          </span>
        )}
      </label>

      <label className="flex flex-col gap-1">
        <span className="typo-caption text-foreground/65">
          {t.agents.build_webhook_source.filter_label}
        </span>
        <input
          type="text"
          data-testid="webhook-source-filter-input"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder={t.agents.build_webhook_source.filter_placeholder}
          className="w-full bg-background/60 border border-border/40 rounded-input px-3 py-1.5 typo-body-sm text-foreground/90 focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
        <span className="typo-caption text-foreground/45">
          {t.agents.build_webhook_source.filter_help}
        </span>
      </label>

      <div className="flex justify-end">
        <button
          type="button"
          data-testid="webhook-source-attach-button"
          onClick={handleSubmit}
          disabled={!isValidUrl}
          className="px-3 py-1 rounded-interactive bg-primary/25 hover:bg-primary/40 disabled:opacity-50 disabled:cursor-not-allowed border border-primary/40 typo-caption text-foreground"
        >
          {t.agents.build_webhook_source.attach_button}
        </button>
      </div>
    </div>
  );
}
