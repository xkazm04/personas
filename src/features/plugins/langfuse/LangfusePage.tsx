import { useState } from "react";
import { ChevronDown, ChevronRight, LineChart } from "lucide-react";
import { ContentBox, ContentHeader, ContentBody } from "@/features/shared/components/layout/ContentLayout";
import { LoadingSpinner } from "@/features/shared/components/feedback/LoadingSpinner";
import { useTranslation } from "@/i18n/useTranslation";
import { ConnectionForm } from "./ConnectionForm";
import { ManagedStackPanel } from "./ManagedStackPanel";
import { StatusPanel } from "./StatusPanel";
import { TraceListPanel } from "./TraceListPanel";
import { useLangfuseSettings } from "./hooks/useLangfuseSettings";
import { useLangfuseStack } from "./hooks/useLangfuseStack";

export default function LangfusePage() {
  const { t } = useTranslation();
  const settings = useLangfuseSettings();
  const stack = useLangfuseStack();

  // Treat the placeholder config (no host stored) as not-yet-manual so the
  // advanced section stays collapsed for first-run users.
  const hasManual =
    !!settings.config && !settings.config.managed && settings.config.host.length > 0;
  const [advancedOpen, setAdvancedOpen] = useState(!!hasManual);
  const preferredPort = settings.config?.preferredPort ?? 3000;

  // Trace-list is only meaningful when the user has a reachable instance.
  // For the managed stack we wait until it's actually Running; for manual
  // we trust the user's enabled flag — the fetch will surface an error if
  // the host is offline.
  const stackRunning = stack.info?.state === "running";
  const showTraceList =
    !!settings.config &&
    settings.config.enabled &&
    settings.config.host.length > 0 &&
    (settings.config.managed ? stackRunning : true);

  return (
    <ContentBox>
      <ContentHeader
        icon={<LineChart className="w-5 h-5 text-indigo-400" />}
        iconColor="indigo"
        title={t.plugins.langfuse.title}
        subtitle={t.plugins.langfuse.subtitle}
      />

      <ContentBody centered>
        <div className="max-w-2xl mx-auto w-full space-y-6 pb-10">
          <div className="px-3 py-2 typo-caption rounded-card border border-indigo-500/20 bg-indigo-500/5 text-indigo-200/80">
            {t.plugins.langfuse.phase_note}
          </div>

          {/* Primary: managed self-host */}
          <section className="rounded-card border border-primary/10 bg-secondary/10 p-5">
            <h2 className="typo-heading mb-4 text-foreground">
              {t.plugins.langfuse.stack_section}
            </h2>
            {stack.loading ? (
              <div className="flex items-center justify-center py-6">
                <LoadingSpinner size="md" label="Loading…" />
              </div>
            ) : (
              <ManagedStackPanel stack={stack} preferredPort={preferredPort} />
            )}
          </section>

          {/* Recent traces — only when there's a reachable instance */}
          {showTraceList && settings.config && (
            <TraceListPanel config={settings.config} />
          )}

          {/* Advanced: bring-your-own */}
          <section className="rounded-card border border-primary/10 bg-secondary/5">
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-secondary/10 transition-colors rounded-card"
            >
              <div>
                <div className="typo-heading text-foreground">
                  {t.plugins.langfuse.advanced_section}
                </div>
                <div className="typo-caption text-foreground/80">
                  {t.plugins.langfuse.advanced_intro}
                </div>
              </div>
              {advancedOpen ? (
                <ChevronDown className="w-4 h-4 text-foreground/80 flex-shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 text-foreground/80 flex-shrink-0" />
              )}
            </button>
            {advancedOpen && (
              <div className="border-t border-primary/10 p-5 space-y-5">
                {settings.loading ? (
                  <div className="flex items-center justify-center py-6">
                    <LoadingSpinner size="md" label="Loading…" />
                  </div>
                ) : (
                  <>
                    {hasManual && (
                      <StatusPanel
                        config={settings.config}
                        onDisconnect={() => void settings.clear()}
                        disconnecting={settings.saving}
                      />
                    )}
                    <ConnectionForm settings={settings} initial={settings.config} />
                  </>
                )}
              </div>
            )}
          </section>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
