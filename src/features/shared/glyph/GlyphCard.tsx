import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Workflow } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import ActivityDiagramModal from '@/features/templates/sub_diagrams/ActivityDiagramModal';
import type { GlyphRow, GlyphDimension } from './types';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import { DIM_META } from './dimMeta';
import { parseChannels } from './channels';
import { triggerIcon, prettyTriggerType, triggerDetail } from './triggers';
import { InteractiveSigil } from './InteractiveSigil';
import { SigilLegend } from './SigilLegend';
import { ChannelTotem } from './ChannelTotem';
import { ConnectorTotem } from './ConnectorTotem';
import { DimensionPanel } from './DimensionPanel';
import { ModelBadge } from './ModelBadge';
import { debtText } from '@/i18n/DebtText';


interface GlyphCardProps {
  row: GlyphRow;
  index: number;
  flow: UseCaseFlow | null;
  templateName?: string;
  /** Small visual indicator rendered top-left over the card (status dot). */
  statusDot?: 'active' | 'paused' | null;
  /** Pill / badge rendered in the header row before the trigger chip — used
   *  for mode tags (E2E / MOCK / INFO) and other per-card metadata. */
  headerBadge?: React.ReactNode;
  /** Extra content in the card footer below the summary — consumers hang
   *  policy chips, action buttons, etc. here. */
  footerSlot?: React.ReactNode;
  /** When provided, each dimension's panel shows a "Refine this dimension"
   *  affordance. The callback receives the dim + use-case context so the
   *  consumer can prefix the user's feedback before sending it to the
   *  build engine. */
  onRefineDimension?: (useCaseId: string, dim: GlyphDimension, feedback: string) => void;
  /** When true, petal clicks are no-ops and any open dim panel shows a
   *  "build in progress" notice instead of edit affordances. */
  isBuilding?: boolean;
}

/** Main capability card. The sigil is the navigation: hover a leaf to see
 *  its name in the header, click to drill into a DimensionPanel. The flow
 *  button (top-right) opens the full ActivityDiagramModal. */
export function GlyphCard({
  row, index, flow, templateName, statusDot, headerBadge, footerSlot,
  onRefineDimension, isBuilding,
}: GlyphCardProps) {
  const { t } = useTranslation();
  const c = t.templates.chronology;
  const motion_ = useMotion();
  const [hoveredDim, setHoveredDim] = useState<GlyphDimension | null>(null);
  const [activeDim, setActiveDim] = useState<GlyphDimension | null>(null);
  const [flowOpen, setFlowOpen] = useState(false);

  const TrigIcon = row.triggers[0] ? triggerIcon(row.triggers[0].trigger_type) : null;
  const trigText = row.triggers[0]
    ? triggerDetail(row.triggers[0]) || prettyTriggerType(t, row.triggers[0].trigger_type)
    : c.manual_only;

  const channels = parseChannels(row.messageSummary);
  const hoveredLabel = hoveredDim ? c[DIM_META[hoveredDim].labelKey] : null;
  const hoveredColor = hoveredDim ? DIM_META[hoveredDim].color : null;

  return (
    <>
      <motion.div
        initial={motion_.shouldAnimate ? { opacity: 0, scale: 0.97 } : false}
        animate={{ opacity: 1, scale: 1 }}
        transition={motion_.shouldAnimate ? { duration: 0.4, delay: index * 0.06 } : { duration: 0 }}
        className="relative rounded-modal bg-card-bg border border-card-border shadow-elevation-2 overflow-hidden group transition-[border-color,box-shadow] duration-300 hover:border-primary/30 hover:shadow-elevation-3"
      >
        <div
          className="absolute inset-0 pointer-events-none opacity-60 group-hover:opacity-90 transition-opacity duration-500"
          style={{
            background:
              `radial-gradient(circle at 50% 50%, ${row.enabled ? DIM_META.trigger.color + '22' : 'transparent'} 0%, transparent 55%),` +
              `radial-gradient(ellipse 80% 50% at 50% 100%, ${row.enabled ? DIM_META.memory.color + '18' : 'transparent'} 0%, transparent 70%)`,
          }}
        />
        <div className="absolute top-0 left-0 w-full h-1/3 pointer-events-none"
          style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.04) 0%, transparent 100%)' }} />

        <div className="relative min-h-[540px] flex flex-col">
          <motion.div
            className="absolute inset-0 flex items-center justify-center"
            animate={{ opacity: activeDim ? 0.18 : 1, scale: activeDim ? 0.94 : 1 }}
            transition={motion_.shouldAnimate ? { duration: 0.3, ease: 'easeOut' } : { duration: 0 }}
          >
            <InteractiveSigil
              row={row} rowIndex={index} size={440}
              hoveredDim={hoveredDim} activeDim={activeDim}
              onHover={setHoveredDim}
              onClick={isBuilding ? () => undefined : setActiveDim}
            />
          </motion.div>

          <motion.div className="absolute inset-0 pointer-events-none"
            animate={{ opacity: activeDim ? 0 : 1 }}
            transition={motion_.shouldAnimate ? { duration: 0.2 } : { duration: 0 }}>
            {channels.length > 0 && <ChannelTotem channels={channels} tileSize={48} spacing={60} max={5} />}
            {row.connectors.length > 0 && <ConnectorTotem connectors={row.connectors} tileSize={52} spacing={64} max={6} />}
          </motion.div>

          {/* Header */}
          <div className="relative z-10 flex items-center gap-3 px-5 py-4 bg-gradient-to-b from-card-bg/95 via-card-bg/70 to-transparent backdrop-blur-sm">
            <span className="typo-data text-foreground tabular-nums">{String(index + 1).padStart(2, '0')}</span>
            <span className={`typo-heading font-bold uppercase tracking-[0.12em] truncate flex-1 ${row.enabled ? 'text-foreground' : 'text-foreground'}`}>
              {row.title}
            </span>

            <AnimatePresence>
              {hoveredLabel && hoveredColor && !activeDim && (
                <motion.span
                  key={hoveredDim}
                  initial={motion_.shouldAnimate ? { opacity: 0, y: -6, scale: 0.94 } : { opacity: 1, y: 0, scale: 1 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={motion_.shouldAnimate ? { opacity: 0, y: -4, scale: 0.94 } : { opacity: 0 }}
                  transition={motion_.shouldAnimate ? { duration: 0.18 } : { duration: 0 }}
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 px-3 py-1 rounded-full typo-label font-bold uppercase tracking-[0.18em] pointer-events-none"
                  style={{
                    background: `${hoveredColor}1f`,
                    border: `1px solid ${hoveredColor}55`,
                    color: hoveredColor,
                    boxShadow: `0 0 12px ${hoveredColor}44`,
                  }}
                >
                  {hoveredLabel}
                </motion.span>
              )}
            </AnimatePresence>

            {!row.enabled && (
              <span className="typo-label px-1.5 py-0.5 rounded bg-foreground/10 text-foreground shrink-0">{c.off_badge}</span>
            )}
            <ModelBadge
              model={row.recommendedModel ?? null}
              rationale={row.modelRationale ?? null}
            />
            {headerBadge}
            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-card-bg/80 backdrop-blur border border-card-border shadow-elevation-1 typo-body text-foreground shrink-0">
              {TrigIcon && <TrigIcon className="w-4 h-4 text-amber-400" />}
              <span className="truncate max-w-[220px]">{trigText}</span>
            </span>

            {flow && flow.nodes.length > 0 && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setFlowOpen(true); }}
                className="w-8 h-8 rounded-full bg-card-bg/80 backdrop-blur border border-card-border shadow-elevation-1 flex items-center justify-center text-foreground hover:text-foreground hover:border-primary/35 cursor-pointer transition-colors shrink-0"
                title={debtText("auto_open_flow_diagram_5e57c30e")}
              >
                <Workflow className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex-1" />

          {/* Footer — sigil colour key + promoted subtitle + consumer slot.
              The legend names every petal at once (the sigil only reveals
              one label on hover) and shares the card's hover/select state. */}
          <div className="relative z-10 flex flex-col gap-2 px-5 py-4 bg-gradient-to-t from-card-bg/95 via-card-bg/75 to-transparent backdrop-blur-sm">
            <SigilLegend
              presence={row.presence}
              hoveredDim={hoveredDim}
              onHover={setHoveredDim}
              onSelect={isBuilding ? undefined : setActiveDim}
              size="sm"
            />
            {row.summary && (
              <p className="typo-body-lg text-foreground leading-snug font-medium line-clamp-3">{row.summary}</p>
            )}
            {footerSlot}
          </div>

          {statusDot && (
            <span
              className={`absolute top-2 left-2 z-20 w-2 h-2 rounded-full ${
                statusDot === 'active'
                  ? 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.7)]'
                  : 'bg-foreground/30'
              }`}
              aria-label={statusDot === 'active' ? 'active' : 'paused'}
            />
          )}

          <AnimatePresence>
            {activeDim && (
              <DimensionPanel
                dim={activeDim}
                row={row}
                onClose={() => setActiveDim(null)}
                isBuilding={isBuilding}
                onRefine={
                  onRefineDimension
                    ? (feedback) => onRefineDimension(row.id, activeDim, feedback)
                    : undefined
                }
              />
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {flow && flow.nodes.length > 0 && (
        <ActivityDiagramModal
          isOpen={flowOpen}
          onClose={() => setFlowOpen(false)}
          templateName={templateName ?? 'Template'}
          flows={[flow]}
        />
      )}
    </>
  );
}
