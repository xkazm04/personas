import { Plug } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import {
  PersonaSigilSummary,
  type PersonaSigilSummaryEntry,
} from '@/features/shared/glyph/persona-layout/PersonaSigilSummary';
import type { GlyphDimension } from '@/features/shared/glyph';

/** One connector chip-card in the left panel — resolved for the active
 *  capability (template placeholder rewritten to the user's concrete pick
 *  when a credential binding exists). */
export interface AdoptionConnectorCard {
  /** CONNECTOR_META slug driving the brand icon/colour (`null` → generic plug). */
  key: string | null;
  /** Display label ("Gmail", "Slack", or the raw connector name). */
  label: string;
  /** Short "what it's for" line from the template, if any. */
  purpose?: string;
}

interface AdoptionLeftPanelProps {
  /** Connectors bound by the active capability. Empty → card hidden. */
  connectors: AdoptionConnectorCard[];
  /** Per-dim resolved value list (the existing summary). */
  summaryEntries: Partial<Record<GlyphDimension, PersonaSigilSummaryEntry>>;
  /** Click a summary row → open that dim (same as a hero-petal click). */
  onSelectDim?: (dim: GlyphDimension) => void;
}

/**
 * Always-rendered left companion to the Persona Sigil in adoption. Reserving
 * this column unconditionally kills the hero re-centering that used to happen
 * when the value summary popped in/out between the "nothing answered yet" and
 * "has selections" states.
 *
 * Top → bottom:
 *   • Connections card — brand icon(s) for the active capability's connector(s).
 *   • Value summary — the existing PersonaSigilSummary (one row per answered dim).
 *   • Muted placeholder — shown only when there's neither a connector nor an
 *     answered dim, so the aside still takes up width.
 */
export function AdoptionLeftPanel({ connectors, summaryEntries, onSelectDim }: AdoptionLeftPanelProps) {
  const { t } = useTranslation();
  const hasConnectors = connectors.length > 0;
  const hasSummary = Object.keys(summaryEntries).length > 0;

  return (
    <div className="flex flex-col gap-4">
      {hasConnectors && (
        <div className="flex flex-col gap-2">
          <span className="typo-label uppercase tracking-[0.18em] text-foreground px-1 inline-flex items-center gap-1.5">
            <Plug className="w-3.5 h-3.5 text-cyan-400" />
            {t.templates.adopt_modal.left_connections_heading}
          </span>
          <ul className="flex flex-col gap-2">
            {connectors.map((cn, i) => {
              const meta = getConnectorMeta(cn.key ?? cn.label);
              return (
                <li key={`${cn.key ?? cn.label}-${i}`}>
                  <Tooltip content={cn.purpose ? `${cn.label} — ${cn.purpose}` : cn.label} placement="right">
                    <div
                      className="relative flex items-center gap-3 px-3 py-2.5 rounded-card bg-secondary/15 border border-card-border/50 overflow-hidden"
                      style={{
                        background:
                          `radial-gradient(ellipse 80% 120% at 0% 50%, ${meta.color}1a 0%, transparent 65%), ` +
                          `linear-gradient(90deg, ${meta.color}08 0%, transparent 100%)`,
                      }}
                    >
                      <span
                        aria-hidden
                        className="absolute left-0 top-0 bottom-0 w-[2px]"
                        style={{ backgroundColor: meta.color, opacity: 0.7 }}
                      />
                      <span
                        className="shrink-0 w-8 h-8 rounded-input bg-card-bg/90 border border-card-border flex items-center justify-center"
                        style={{ boxShadow: `0 0 10px ${meta.color}33` }}
                      >
                        <ConnectorIcon meta={meta} size="w-5 h-5" />
                      </span>
                      <span className="min-w-0 flex flex-col">
                        <span className="typo-body-lg leading-snug text-foreground truncate">{cn.label}</span>
                        {cn.purpose && (
                          <span className="typo-caption text-foreground truncate">{cn.purpose}</span>
                        )}
                      </span>
                    </div>
                  </Tooltip>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {hasSummary && (
        <PersonaSigilSummary entries={summaryEntries} heading={null} onSelectDim={onSelectDim} />
      )}

      {!hasConnectors && !hasSummary && (
        <div className="rounded-card border border-dashed border-card-border/60 bg-secondary/10 px-3 py-4">
          <span className="typo-caption text-foreground leading-relaxed">
            {t.templates.adopt_modal.left_empty_placeholder}
          </span>
        </div>
      )}
    </div>
  );
}
