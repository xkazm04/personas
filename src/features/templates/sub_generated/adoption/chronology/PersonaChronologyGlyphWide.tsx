/**
 * PersonaChronologyGlyphWide — Prototype B-Wide: GlyphCard at 2-column scale.
 *
 * Same visual language as Glyph (sigil hero + connector / channel totems +
 * policy strip), but each card gets a 2-column grid slot and ~440px sigil.
 * The extra real estate lets the side totems run at 48px tiles and a
 * richer footer show summary + full policy chip set without wrapping.
 *
 * Shares the sigil, helpers, and totem components with Glyph so there's
 * one source of truth for the visual system.
 */
import { useState, memo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { useAgentStore } from '@/stores/agentStore';
import { useUseCaseChronology, useUseCaseFlows } from './useUseCaseChronology';
import { ChronologyCommandHub, type ChronologyCommandHubProps } from './ChronologyCommandHub';
import { CapabilityMatrix } from './CapabilityMatrix';
import {
  CapabilitySigil,
  ConnectorTotem,
  ChannelTotem,
  PolicyStrip,
  DIM_META,
  parseChannels,
  triggerIcon,
  triggerDetail,
  prettyTriggerType,
} from './PersonaChronologyGlyph';
import type { ChronologyRow } from './useUseCaseChronology';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';

type Props = ChronologyCommandHubProps;

function GlyphWideCard({ row, index, flow, templateName }: {
  row: ChronologyRow;
  index: number;
  flow: UseCaseFlow | null;
  templateName?: string;
}) {
  const { t } = useTranslation();
  const c = t.templates.chronology;
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const TrigIcon = row.triggers[0] ? triggerIcon(row.triggers[0].trigger_type) : null;
  const trigText = row.triggers[0]
    ? (() => {
      const detail = triggerDetail(row.triggers[0]);
      const label = prettyTriggerType(t, row.triggers[0].trigger_type);
      return detail ? detail : label;
    })()
    : c.manual_only;

  const channels = parseChannels(row.messageSummary);

  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, delay: index * 0.06 }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      className={`relative rounded-modal bg-card-bg border overflow-hidden group transition-[border-color,box-shadow,transform] duration-300 ${
        expanded
          ? 'border-primary/35 col-span-full shadow-elevation-3'
          : 'border-card-border shadow-elevation-2 hover:border-primary/30 hover:-translate-y-1 hover:shadow-elevation-3'
      }`}
    >
      <div
        className={`absolute inset-0 pointer-events-none transition-opacity duration-500 ${hovered ? 'opacity-100' : 'opacity-60'}`}
        style={{
          background:
            `radial-gradient(circle at 50% 50%, ${row.enabled ? DIM_META.trigger.color + '22' : 'transparent'} 0%, transparent 55%),` +
            `radial-gradient(ellipse 80% 50% at 50% 100%, ${row.enabled ? DIM_META.memory.color + '18' : 'transparent'} 0%, transparent 70%)`,
        }}
      />
      <div
        className="absolute top-0 left-0 w-full h-1/3 pointer-events-none"
        style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.04) 0%, transparent 100%)' }}
      />

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="relative w-full text-left cursor-pointer min-h-[540px] flex flex-col"
      >
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <CapabilitySigil row={row} rowIndex={index} hovered={hovered} size={440} />
        </div>

        {channels.length > 0 && (
          <ChannelTotem channels={channels} side="left" tileSize={48} spacing={60} max={5} />
        )}
        {row.connectors.length > 0 && (
          <ConnectorTotem connectors={row.connectors} side="right" tileSize={52} spacing={64} max={6} />
        )}

        {/* Header */}
        <div className="relative z-10 flex items-center gap-3 px-5 py-4 bg-gradient-to-b from-card-bg/95 via-card-bg/70 to-transparent backdrop-blur-sm">
          <span className="typo-data text-foreground/55 tabular-nums">
            {String(index + 1).padStart(2, '0')}
          </span>
          <span className={`typo-heading font-bold uppercase tracking-[0.12em] truncate flex-1 ${row.enabled ? 'text-foreground' : 'text-foreground/50'}`}>
            {row.title}
          </span>
          {!row.enabled && (
            <span className="typo-label px-1.5 py-0.5 rounded bg-foreground/10 text-foreground/70 shrink-0">
              {c.off_badge}
            </span>
          )}
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-card-bg/80 backdrop-blur border border-card-border shadow-elevation-1 typo-body text-foreground shrink-0">
            {TrigIcon && <TrigIcon className="w-4 h-4 text-amber-400" />}
            <span className="truncate max-w-[220px]">{trigText}</span>
          </span>
        </div>

        <div className="flex-1" />

        {/* Footer */}
        <div className="relative z-10 flex flex-col gap-2 px-5 py-4 bg-gradient-to-t from-card-bg/95 via-card-bg/75 to-transparent backdrop-blur-sm">
          {row.summary && (
            <div className="typo-body text-foreground/90 leading-snug line-clamp-3">
              {row.summary}
            </div>
          )}
          <PolicyStrip row={row} />
        </div>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="overflow-hidden relative"
          >
            <div className="border-t border-card-border/60">
              <CapabilityMatrix row={row} flow={flow} templateName={templateName} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function PersonaChronologyGlyphWideImpl(props: Props) {
  const { t } = useTranslation();
  const rows = useUseCaseChronology();
  const flowsById = useUseCaseFlows();
  const templateName = useAgentStore((s) => {
    const draft = s.buildDraft as Record<string, unknown> | null;
    const name = draft?.name;
    return typeof name === 'string' ? name : undefined;
  });
  const c = t.templates.chronology;

  return (
    <div className="flex flex-col gap-3 w-full h-full min-w-[900px]">
      <ChronologyCommandHub {...props} />
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        {rows.length === 0 ? (
          <div className="rounded-modal bg-card-bg border border-card-border p-8 text-center shadow-elevation-2">
            <span className="typo-body text-foreground/75 italic">{c.empty_seeding}</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {rows.map((row, i) => (
              <GlyphWideCard
                key={row.id}
                row={row}
                index={i}
                flow={flowsById.get(row.id) ?? null}
                templateName={templateName}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export const PersonaChronologyGlyphWide = memo(PersonaChronologyGlyphWideImpl);
