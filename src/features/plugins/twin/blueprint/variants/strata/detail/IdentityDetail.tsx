/**
 * Identity at L2: the name and role as the user typed them (wrapping, never
 * clipped), the bio against its readiness target, the languages, and readiness
 * itself: a ring on 0..100 beside the four slots. Each block opens its part of
 * L3.
 */
import { StatusGlyph } from '../../../../setup/SetupReadinessRow';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';

import type { ReadinessSlot, TwinBlueprintModel } from '../../../blueprintContract';
import { StrataFigure } from '../StrataFigure';
import { clamp01 } from '../strataModel';
import { PressRow, StrataMeter } from './StrataMeter';

const SLOTS: readonly ReadinessSlot[] = ['identity', 'tone', 'channels', 'memories'];
const R = 44;
const C = 2 * Math.PI * R;

export function IdentityDetail({ model, onOpen }: { model: TwinBlueprintModel; onOpen: (key?: string) => void }) {
  const { t } = useTranslation();
  const tm = t.twin.blueprint.metrics;
  const { name, role, bioChars, bioTarget, languages } = model.identity;
  const score = clamp01(model.readiness.score / 100);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="typo-heading-lg text-foreground break-words">{name}</span>
        {role ? (
          <span className="typo-body text-foreground break-words">{role}</span>
        ) : (
          <span className="typo-body text-foreground" data-measured="false">-</span>
        )}
      </div>

      <div className="strata-two">
        <div className="flex flex-col gap-3 min-w-0">
          <PressRow label={tm.bio} onPress={() => onOpen('bio')} className="strata-block" testId="strata-item-bio">
            <span className="typo-label text-primary">{tm.bio}</span>
            <StrataMeter value={bioChars} fullAt={bioTarget} className="strata-meter--lg" />
            <span className="inline-flex items-baseline gap-1.5">
              <StrataFigure value={bioChars} className="typo-data-lg text-foreground" />
              <span className="typo-caption">/</span>
              <StrataFigure value={bioTarget} className="typo-data text-foreground" />
            </span>
          </PressRow>

          <PressRow label={tm.languages} onPress={() => onOpen('languages')} className="strata-block" testId="strata-item-languages">
            <span className="typo-label text-primary">{tm.languages}</span>
            {languages.length === 0 ? (
              <span className="typo-caption" data-measured="false">{tm.noLanguages}</span>
            ) : (
              <span className="flex flex-wrap gap-2">
                {languages.map((code) => (
                  <span key={code} className="strata-chip-lang typo-data">{code.toUpperCase()}</span>
                ))}
              </span>
            )}
          </PressRow>
        </div>

        <PressRow label={tm.readiness} onPress={() => onOpen('readiness')} className="strata-block" testId="strata-item-readiness">
          <span className="typo-label text-primary">{tm.readiness}</span>
          <div className="flex items-center gap-5 min-w-0">
            <span className="strata-ring">
              <svg viewBox="0 0 112 112" aria-hidden focusable="false">
                <circle className="strata-ring-track" cx="56" cy="56" r={R} />
                <circle className="strata-ring-arc" cx="56" cy="56" r={R} strokeDasharray={`${C * score} ${C}`} />
              </svg>
              <Numeric value={score} unit="ratio" precision={0} className="strata-ring-figure typo-data-lg text-foreground" />
            </span>
            <ul className="flex flex-col gap-2 min-w-0">
              {SLOTS.map((slot) => (
                <li key={slot} className="flex items-center gap-2.5 min-w-0" data-slot-status={model.readiness.slots[slot]}>
                  <StatusGlyph status={model.readiness.slots[slot]} />
                  <span className="typo-body text-foreground truncate">{t.twin.experience.slots[slot].label}</span>
                </li>
              ))}
            </ul>
          </div>
        </PressRow>
      </div>
    </div>
  );
}
