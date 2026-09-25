/** useFrameValues — what each of the eight frames is a picture OF, read from
 *  real sources only, most-settled first:
 *    1. glyphRows (the draft's per-capability dimension data)
 *    2. the live build store (capabilities / connectors streaming in)
 *    3. answers the user has given on this sheet but not yet sent
 *    4. the compose-time quick config (schedule, apps, channels, events, toggles)
 *  Nothing is staged; a frame with no source stays unexposed. */
import { useMemo } from "react";
import type { GlyphDimension, GlyphRow } from "@/features/shared/glyph";
import { GLYPH_DIMENSIONS, humanizeCron, parseChannels } from "@/features/shared/glyph";
import type { QuickConfigState } from "@/features/agents/shared/quickConfig/quickConfigTypes";
import { describeTriggerConfig } from "@/features/agents/shared/quickConfig/quickConfigTypes";
import { getConnectorMeta } from "@/lib/connectors/connectorMeta";
import { useAgentStore } from "@/stores/agentStore";
import { useTranslation } from "@/i18n/useTranslation";
import { capabilityTitles, dedupeConnectorNames } from "@/features/agents/sub_glyph/cinemaShared";
import { weekFromCron, weekFromQuickConfig, type WeekPicture } from "./sheetModel";
import { COPY } from "./copy";

export interface FrameValue {
  caption: string;
  lines: string[];
  week?: WeekPicture | null;
  triggerKind?: string;
  apps?: string[];
  channels?: string[];
  caps?: string[];
  events?: string[];
  on?: boolean;
  by: "you" | "ai" | null;
}

interface Args {
  glyphRows: GlyphRow[];
  quickConfig: QuickConfigState | null;
  toggles: { memory: boolean; review: boolean };
  intentText: string;
  answered: Partial<Record<GlyphDimension, string>>;
  isCompose: boolean;
}

const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean)));
const cronOf = (cfg: Record<string, unknown> | undefined) =>
  typeof cfg?.cron === "string" ? cfg.cron : typeof cfg?.schedule === "string" ? cfg.schedule : null;

export function useFrameValues({ glyphRows, quickConfig: qc, toggles, intentText, answered, isCompose }: Args) {
  const { t } = useTranslation();
  const storeCaps = useAgentStore((s) => s.buildCapabilities);
  const storeOrder = useAgentStore((s) => s.buildCapabilityOrder);
  const resolution = useAgentStore((s) => s.buildPersonaResolution);

  return useMemo(() => {
    const out = {} as Record<GlyphDimension, FrameValue | null>;
    const rows = glyphRows;
    const liveCaps = storeOrder.map((id) => storeCaps[id]).filter((c): c is NonNullable<typeof c> => !!c);
    const rowSummary = (pick: (r: GlyphRow) => string | undefined) => uniq(rows.map(pick).map((s) => s?.trim() ?? ""));

    for (const dim of GLYPH_DIMENSIONS) {
      let v: FrameValue | null = null;
      if (dim === "trigger") {
        const trig = rows.flatMap((r) => r.triggers)[0]
          ?? liveCaps.map((c) => c.suggested_trigger).find(Boolean) ?? null;
        if (trig) {
          const cron = cronOf(trig.config as Record<string, unknown> | undefined);
          v = {
            week: cron ? weekFromCron(cron) : null,
            triggerKind: trig.trigger_type,
            caption: cron ? humanizeCron(t, cron) : trig.description || trig.trigger_type,
            lines: uniq(rows.flatMap((r) => r.triggers.map((x) => x.description || x.trigger_type))),
            by: "ai",
          };
        } else if (qc && (qc.frequency || qc.selectedEvents.length)) {
          const lines = describeTriggerConfig(qc);
          v = { week: weekFromQuickConfig(qc.frequency, qc.days, qc.time), triggerKind: qc.frequency ? "schedule" : "event", caption: lines.join(" · "), lines, by: "you" };
        }
      } else if (dim === "task") {
        const caps = rows.length ? rows.map((r) => r.title) : capabilityTitles(storeOrder, storeCaps);
        if (caps.length) v = { caps, caption: `${caps.length} ${COPY.capabilities.toLowerCase()}`, lines: caps, by: "ai" };
        else if (isCompose && intentText.trim()) v = { caption: intentText.trim(), lines: [intentText.trim()], by: "you" };
      } else if (dim === "connector") {
        const apps = rows.length
          ? uniq(rows.flatMap((r) => r.connectors.map((c) => c.name)))
          : dedupeConnectorNames(resolution.connectors).length ? dedupeConnectorNames(resolution.connectors)
          : qc?.selectedConnectors ?? [];
        const by = rows.length || resolution.connectors?.length ? "ai" : "you";
        if (apps.length) {
          const labels = apps.map((a) => getConnectorMeta(a).label);
          v = { apps, caption: labels.slice(0, 2).join(", ") + (labels.length > 2 ? ` +${labels.length - 2}` : ""), lines: labels, by };
        }
      } else if (dim === "message") {
        const fromRows = uniq(rows.flatMap((r) => parseChannels(r.messageSummary).map((c) => c.type)));
        const fromQc = (qc?.notificationChannels ?? []).map((c) => c.type).filter((x) => x !== "built-in" && x !== "titlebar");
        const channels = fromRows.length ? fromRows : fromQc;
        if (channels.length) v = { channels, caption: channels.join(", "), lines: rowSummary((r) => r.messageSummary), by: fromRows.length ? "ai" : "you" };
      } else if (dim === "event") {
        const fromRows = uniq(rows.flatMap((r) => r.events.map((e) => e.description || e.event_type)));
        const fromQc = (qc?.selectedEvents ?? []).map((e) => e.personaName);
        const events = fromRows.length ? fromRows : fromQc;
        if (events.length) v = { events, caption: events[0]!, lines: events, by: fromRows.length ? "ai" : "you" };
      } else {
        const pick = { review: (r: GlyphRow) => r.reviewSummary, memory: (r: GlyphRow) => r.memorySummary, error: (r: GlyphRow) => r.errorSummary }[dim];
        const lines = rowSummary(pick);
        if (lines.length) v = { on: true, caption: lines[0]!, lines, by: "ai" };
        else if (dim !== "error" && toggles[dim]) v = { on: true, caption: COPY.frame.on, lines: [], by: "you" };
      }
      const ans = answered[dim];
      if (ans && (!v || v.by !== "ai")) v = { ...(v ?? { lines: [] }), caption: ans, lines: [ans, ...(v?.lines ?? [])], by: "you" };
      out[dim] = v;
    }
    return out;
  }, [glyphRows, qc, toggles, intentText, answered, isCompose, storeCaps, storeOrder, resolution, t]);
}
