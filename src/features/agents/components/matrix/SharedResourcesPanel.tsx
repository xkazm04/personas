/**
 * SharedResourcesPanel -- persona-wide resources in the v3 layout.
 *
 * Surfaces the `persona.tools`, `persona.connectors`, `persona.notification_
 * channels_default`, and prose fields (operating_instructions, tool_guidance,
 * error_handling) from the current session. Read-only for now; edit flows
 * route through the existing DimensionEditPanel for the relevant cells.
 */

import { Wrench, Plug, Bell, Book, AlertTriangle, Brain } from "lucide-react";
import { useAgentStore } from "@/stores/agentStore";
import { useTranslation } from "@/i18n/useTranslation";

export function SharedResourcesPanel() {
  const { t } = useTranslation();
  const res = useAgentStore((s) => s.buildPersonaResolution);

  const hasAnything =
    (res.tools?.length ?? 0) > 0 ||
    (res.connectors?.length ?? 0) > 0 ||
    (res.notification_channels_default?.length ?? 0) > 0 ||
    Boolean(res.operating_instructions) ||
    Boolean(res.tool_guidance) ||
    Boolean(res.error_handling) ||
    (res.core_memories?.length ?? 0) > 0;

  return (
    <section
      className="flex flex-col gap-5 rounded-2xl border border-border/30 bg-secondary/10 p-5"
      data-testid="shared-resources-panel"
    >
      <header className="flex flex-col gap-1">
        <h3 className="typo-heading-sm text-foreground">
          {t.matrix_v3.shared_resources_section_title}
        </h3>
        <p className="typo-body-sm text-foreground/50">
          {t.matrix_v3.shared_resources_section_subtitle}
        </p>
      </header>

      {!hasAnything ? (
        <p
          className="typo-body-sm text-foreground/40"
          data-testid="shared-resources-empty"
        >
          {t.matrix_v3.shared_resources_empty}
        </p>
      ) : (
        <div className="grid gap-5 md:grid-cols-3">
          {/* Tools */}
          <div
            className="flex flex-col gap-2"
            data-testid="shared-resources-tools"
          >
            <div className="flex items-center gap-2 text-foreground/80">
              <Wrench className="h-3.5 w-3.5" />
              <span className="typo-label">{t.matrix_v3.shared_resources_tools_label}</span>
            </div>
            <ul className="flex flex-wrap gap-1.5">
              {(res.tools ?? []).map((tool, i) => (
                <li
                  key={`${tool.name}-${i}`}
                  className="rounded-full bg-secondary/40 px-2.5 py-0.5 typo-caption text-foreground"
                  title={tool.description}
                >
                  {tool.name}
                </li>
              ))}
            </ul>
          </div>

          {/* Connectors */}
          <div
            className="flex flex-col gap-2"
            data-testid="shared-resources-connectors"
          >
            <div className="flex items-center gap-2 text-foreground/80">
              <Plug className="h-3.5 w-3.5" />
              <span className="typo-label">
                {t.matrix_v3.shared_resources_connectors_label}
              </span>
            </div>
            <ul className="flex flex-col gap-1">
              {(res.connectors ?? []).map((c, i) => (
                <li
                  key={`${c.name}-${i}`}
                  className="flex items-center gap-2 typo-caption"
                >
                  <span className="font-medium text-foreground">{c.name}</span>
                  <span className="text-foreground/50">({c.service_type})</span>
                  {c.has_credential ? (
                    <span className="text-emerald-500">✓</span>
                  ) : (
                    <span className="text-amber-500">!</span>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* Defaults */}
          <div
            className="flex flex-col gap-3"
            data-testid="shared-resources-defaults"
          >
            <div className="flex items-center gap-2 text-foreground/80">
              <Bell className="h-3.5 w-3.5" />
              <span className="typo-label">
                {t.matrix_v3.shared_resources_defaults_label}
              </span>
            </div>
            <div className="flex flex-col gap-1.5 typo-caption text-foreground/60">
              {(res.notification_channels_default ?? []).map((ch, i) => (
                <span key={`${ch.channel}-${i}`}>
                  {ch.channel}: {ch.target}
                </span>
              ))}
            </div>
          </div>

          {/* Operating instructions */}
          {res.operating_instructions ? (
            <div className="md:col-span-3 flex flex-col gap-1.5">
              <div className="flex items-center gap-2 text-foreground/80">
                <Book className="h-3.5 w-3.5" />
                <span className="typo-label">
                  {t.matrix_v3.shared_resources_operating_instructions_label}
                </span>
              </div>
              <p className="typo-body-sm text-foreground/70 whitespace-pre-wrap">
                {res.operating_instructions}
              </p>
            </div>
          ) : null}

          {/* Tool guidance */}
          {res.tool_guidance ? (
            <div className="md:col-span-3 flex flex-col gap-1.5">
              <div className="flex items-center gap-2 text-foreground/80">
                <Wrench className="h-3.5 w-3.5" />
                <span className="typo-label">
                  {t.matrix_v3.shared_resources_tool_guidance_label}
                </span>
              </div>
              <p className="typo-body-sm text-foreground/70 whitespace-pre-wrap">
                {res.tool_guidance}
              </p>
            </div>
          ) : null}

          {/* Error handling */}
          {res.error_handling ? (
            <div className="md:col-span-3 flex flex-col gap-1.5">
              <div className="flex items-center gap-2 text-foreground/80">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span className="typo-label">
                  {t.matrix_v3.shared_resources_error_handling_label}
                </span>
              </div>
              <p className="typo-body-sm text-foreground/70 whitespace-pre-wrap">
                {res.error_handling}
              </p>
            </div>
          ) : null}

          {/* Core memories */}
          {res.core_memories && res.core_memories.length > 0 ? (
            <div className="md:col-span-3 flex flex-col gap-1.5">
              <div className="flex items-center gap-2 text-foreground/80">
                <Brain className="h-3.5 w-3.5" />
                <span className="typo-label">
                  {t.matrix_v3.shared_resources_core_memories_label}
                </span>
              </div>
              <ul className="flex flex-col gap-1 typo-caption text-foreground/70">
                {res.core_memories.map((m, i) => (
                  <li key={i}>
                    <span className="font-medium">{m.title}:</span> {m.content}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
