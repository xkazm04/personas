/**
 * L2 Identity: the quadrant unfolded into a full ring. Inner cells: the four
 * readiness slots (set full, partly set half, not set empty). Middle: the bio
 * arc against its readiness target (chevrons past it, hatched when there is no
 * bio). Outer: one mark per language, its code beside it at full type size.
 * The hub carries readiness; the panel carries the counts.
 */
import { useTranslation } from '@/i18n/useTranslation';

import type { ReadinessSlot, ReadinessStatus, TwinBlueprintModel } from '../../../blueprintContract';
import { readinessWeight } from '../../../sectionMetrics';
import { CellRing } from '../glyphs/CellRing';
import { LanguageDots, languageDotPositions } from '../glyphs/LanguageDots';
import { ShareArc, type RadialIds } from '../glyphs/primitives';
import { polar } from '../radialGeometry';
import { LANGUAGE_MARKS } from '../radialModel';
import { FocusBody, FocusFigure } from './FocusBody';
import { LegendKey, PanelGroup, type SwatchKind } from './PanelParts';
import { RadialFigure } from '../RadialFigure';

interface IdentityFocusProps {
  model: TwinBlueprintModel;
  ids: RadialIds;
  panelW: number;
  reduced: boolean;
  onOpen: (itemKey?: string) => void;
}

const SLOTS: readonly ReadinessSlot[] = ['identity', 'tone', 'channels', 'memories'];
const SLOT_SWATCH: Record<ReadinessStatus, SwatchKind> = { set: 'fill', partial: 'half', empty: 'track' };

export function IdentityFocus({ model, ids, panelW, reduced, onOpen }: IdentityFocusProps) {
  const { t, tx } = useTranslation();
  const tb = t.twin.blueprint;
  const rc = tb.variantCopy.radial;
  const { identity, readiness } = model;
  const status: Record<ReadinessStatus, string> = { set: rc.slotSet, partial: rc.slotPartial, empty: rc.slotEmpty };
  const langs = identity.languages;

  return (
    <FocusBody
      panelW={panelW}
      reduced={reduced}
      figure={(geo) => {
        const { cx, cy, R } = geo;
        const langBand = { cx, cy, r0: R * 0.74, r1: R * 0.86, a0: 0, a1: 354 };
        const dots = languageDotPositions(langBand, langs.length, LANGUAGE_MARKS);
        return (
          <FocusFigure
            geo={geo}
            ids={ids}
            guides={[0.29, 0.43, 0.5, 0.65, 0.8]}
            hub={{ value: readiness.score / 100, unit: 'ratio', label: tb.metrics.readiness }}
            overlay={dots.map((p, k) => {
              const at = polar(cx, cy, R * 0.97, Math.atan2(p.x - cx, cy - p.y) * (180 / Math.PI));
              return (
                <span key={langs[k]} className="rd-lang-code typo-label text-foreground" style={{ left: at.x, top: at.y }}>
                  {(langs[k] ?? '').toLocaleUpperCase()}
                </span>
              );
            })}
          >
            <g className="rd-pick" onClick={() => onOpen()}>
              <CellRing
                band={{ cx, cy, r0: R * 0.29, r1: R * 0.43, a0: 0, a1: 360 }}
                cells={SLOTS.map((s) => ({ key: s, solid: readinessWeight(readiness.slots[s]) }))}
                ids={ids}
                gapPx={8}
                testId="radial-slots"
              />
              <ShareArc
                band={{ cx, cy, r0: R * 0.5, r1: R * 0.65, a0: 0, a1: 350 }}
                value={identity.bioChars}
                fullAt={identity.bioTarget}
                ids={ids}
                testId="radial-bio"
              />
              <LanguageDots band={langBand} count={langs.length} slots={LANGUAGE_MARKS} />
            </g>
          </FocusFigure>
        );
      }}
      panel={
        <>
          {identity.role && <p className="typo-body-lg text-foreground">{identity.role}</p>}
          <PanelGroup title={tb.metrics.readiness} testId="radial-slot-keys">
            <div className="rd-legend is-column">
              {SLOTS.map((s) => (
                <div key={s} className="rd-slot-row" data-testid={`radial-slot-${s}`} data-status={readiness.slots[s]}>
                  <LegendKey kind={SLOT_SWATCH[readiness.slots[s]]} ids={ids} label={t.twin.setup.checklist[s]} />
                  {status[readiness.slots[s]] && <span className="typo-caption">{status[readiness.slots[s]]}</span>}
                </div>
              ))}
            </div>
          </PanelGroup>
          <PanelGroup title={tb.metrics.bio}>
            <div className="rd-stat-line" data-testid="radial-key-bio">
              <RadialFigure value={identity.bioChars} className="typo-data-lg text-foreground" />
              {rc.target && <span className="typo-caption">{tx(rc.target, { count: identity.bioTarget })}</span>}
            </div>
          </PanelGroup>
          <PanelGroup title={tb.metrics.languages}>
            {langs.length === 0 ? (
              <p className="typo-caption">{tb.metrics.noLanguages}</p>
            ) : (
              <p className="typo-body text-foreground">{langs.map((l) => l.toLocaleUpperCase()).join(' · ')}</p>
            )}
          </PanelGroup>
        </>
      }
    />
  );
}
