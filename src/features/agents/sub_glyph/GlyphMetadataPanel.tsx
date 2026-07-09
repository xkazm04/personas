/** GlyphMetadataPanel — the readable persona/capability metadata that sits
 *  alongside the sigil on the post-compose stage.
 *
 *  The sigil is the diagram; this is the "here's what you built" readout. It
 *  reads the same live build scalars the Cinema does (behaviorCore, capabilities,
 *  personaResolution) so the crowned-identity reveal in the loading cinema flows
 *  straight into a persistent, well-formed metadata card as the build resolves
 *  and setup finishes. Renders nothing until the real identity exists, so it
 *  fades in exactly when there's something true to show.
 */
import { motion, AnimatePresence } from "framer-motion";
import { Check, Cpu, KeyRound } from "lucide-react";
import { useMemo } from "react";
import { useAgentStore } from "@/stores/agentStore";
import { getConnectorMeta, ConnectorIcon } from "@/lib/connectors/connectorMeta";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";

const ACCENT = "#60A5FA";
const EASE = [0.16, 1, 0.3, 1] as const;

export function GlyphMetadataPanel({ agentName }: { agentName: string }) {
  const behaviorCore = useAgentStore((s) => s.buildBehaviorCore);
  const capabilities = useAgentStore((s) => s.buildCapabilities);
  const capabilityOrder = useAgentStore((s) => s.buildCapabilityOrder);
  const personaResolution = useAgentStore((s) => s.buildPersonaResolution);

  const role = behaviorCore?.identity?.role ?? null;
  const mission = behaviorCore?.mission ?? null;
  const voiceStyle = behaviorCore?.voice?.style ?? null;

  const caps = useMemo(
    () => capabilityOrder.map((id) => capabilities[id]).filter((c): c is NonNullable<typeof c> => !!c?.title),
    [capabilityOrder, capabilities],
  );
  const connectors = useMemo(() => {
    const seen = new Set<string>();
    return (personaResolution.connectors ?? []).filter((c) => {
      const key = (c.service_type || c.name || "").toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [personaResolution]);

  // Nothing true to show yet — stay out of the way (the sigil carries the stage).
  if (!role && !mission && caps.length === 0) return null;

  return (
    <motion.aside
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.45, ease: EASE }}
      className="w-[340px] shrink-0 pt-6 flex flex-col gap-4"
      data-testid="glyph-metadata-panel"
    >
      {/* persona identity */}
      <div className="flex flex-col gap-1.5 px-4 py-3.5 rounded-card border bg-card-bg" style={{ borderColor: colorWithAlpha(ACCENT, 0.3) }}>
        <span className="typo-label text-foreground">Persona</span>
        <span className="typo-title-lg text-foreground" data-testid="metadata-name">{agentName?.trim() || "Your agent"}</span>
        {role && <span className="typo-caption" style={{ color: ACCENT }}>{role}</span>}
        {mission && <span className="typo-body text-foreground mt-0.5">{mission}</span>}
        {voiceStyle && (
          <span className="typo-caption mt-1 line-clamp-2">
            <span className="uppercase tracking-wide">Voice · </span>{voiceStyle}
          </span>
        )}
      </div>

      {/* capabilities */}
      <div className="flex flex-col gap-2">
        <span className="typo-label text-foreground px-1">Capabilities · {caps.length}</span>
        <AnimatePresence initial={false}>
          {caps.map((cap, i) => (
            <motion.div
              key={cap.id ?? cap.title ?? i}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: EASE, delay: Math.min(i * 0.04, 0.2) }}
              className="flex flex-col gap-1.5 px-3 py-2.5 rounded-card border bg-card-bg"
              style={{ borderColor: colorWithAlpha(ACCENT, 0.22) }}
              data-testid="metadata-capability"
            >
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full flex items-center justify-center shrink-0" style={{ background: colorWithAlpha(ACCENT, 0.2) }}>
                  <Check className="w-2.5 h-2.5" style={{ color: ACCENT }} />
                </span>
                <span className="typo-body font-medium text-foreground truncate">{cap.title}</span>
              </div>
              {cap.capability_summary && (
                <span className="typo-caption line-clamp-2 pl-6">{cap.capability_summary}</span>
              )}
              {(cap.connectors?.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-1 pl-6 pt-0.5">
                  {cap.connectors!.map((name) => {
                    const meta = getConnectorMeta(name);
                    return (
                      <span
                        key={name}
                        className="inline-flex items-center gap-1 pl-0.5 pr-1.5 py-0.5 rounded-full border"
                        style={{ borderColor: colorWithAlpha(meta.color, 0.35), background: colorWithAlpha(meta.color, 0.1) }}
                      >
                        <span className="w-3.5 h-3.5 rounded-full flex items-center justify-center">
                          <ConnectorIcon meta={meta} />
                        </span>
                        <span className="typo-caption text-foreground/85">{meta.label}</span>
                      </span>
                    );
                  })}
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        {caps.length === 0 && (
          <div className="flex items-center gap-2 px-3 py-2 typo-caption">
            <Cpu className="w-3.5 h-3.5 text-primary animate-pulse" />
            <span>Resolving capabilities…</span>
          </div>
        )}
      </div>

      {/* persona-wide connectors with credential status */}
      {connectors.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="typo-label text-foreground px-1">Connections · {connectors.length}</span>
          <div className="flex flex-col gap-1">
            {connectors.map((c) => {
              const meta = getConnectorMeta(c.service_type || c.name);
              return (
                <div key={c.name + c.service_type} className="flex items-center gap-2 px-2.5 py-1.5 rounded-card border bg-card-bg" style={{ borderColor: colorWithAlpha(meta.color, 0.22) }}>
                  <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: colorWithAlpha(meta.color, 0.14) }}>
                    <ConnectorIcon meta={meta} />
                  </span>
                  <span className="typo-caption text-foreground truncate flex-1">{meta.label}</span>
                  {c.has_credential ? (
                    <span className="inline-flex items-center gap-1 typo-caption text-status-success">
                      <KeyRound className="w-3 h-3" /> ready
                    </span>
                  ) : (
                    <span className="typo-caption">needs key</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </motion.aside>
  );
}
