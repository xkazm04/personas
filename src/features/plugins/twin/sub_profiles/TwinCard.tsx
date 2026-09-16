import { Check, Trash2 } from 'lucide-react';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { genderDefFromPronouns } from '../shared/gender';
import type { TwinSlotId } from '../shared/twinStatus';
import type { ProfileDashboardData } from '../useProfileDashboards';
import { TwinChannelMarks } from './TwinChannelMarks';
import { TwinSlotStrip } from './TwinSlotStrip';
import type { TwinProfile } from '@/lib/bindings/TwinProfile';

/**
 * One twin, as a card.
 *
 * The card answers three questions and refuses the rest: WHO (name, role),
 * WHERE IT SPEAKS (the channel marks, which are the dominant element), and
 * WHAT IS STILL MISSING (the four-segment strip along the bottom). The bio
 * paragraph, the Obsidian path, the languages list and the five milestone rows
 * the previous card carried all moved to Setup and Hub — the middle of the
 * card is deliberately open, and readiness is stated ONCE, as a number.
 *
 * Interaction model: an overlay button fills the card and activates the twin,
 * so a press anywhere lands somewhere sensible. The content layer above it is
 * `pointer-events-none` and each real control re-enables itself, which is what
 * keeps the channel marks and the footer segments clickable and hoverable
 * without nesting a button inside a button.
 */

interface TwinCardProps {
  profile: TwinProfile;
  dash: ProfileDashboardData | undefined;
  isActive: boolean;
  /** Position in the current reveal wave. */
  order: number;
  hasEntered: (id: string) => boolean;
  markEntered: (id: string) => void;
  onActivate: () => void;
  onOpenSlot: (slot: TwinSlotId) => void;
  onAddChannel: () => void;
  onDelete: () => void;
}

export function TwinCard({
  profile,
  dash,
  isActive,
  order,
  hasEntered,
  markEntered,
  onActivate,
  onOpenSlot,
  onAddChannel,
  onDelete,
}: TwinCardProps) {
  const { t, tx } = useTranslation();
  const twin = t.twin;
  const gender = genderDefFromPronouns(profile.pronouns ?? null);

  return (
    <RevealItem
      revealId={profile.id}
      order={order}
      hasEntered={hasEntered}
      markEntered={markEntered}
      data-testid="twin-card"
      className={`group relative flex flex-col rounded-card border transition-colors ${
        isActive
          ? 'border-primary/30 bg-primary/[0.04] shadow-elevation-2'
          : 'border-primary/10 bg-card-bg hover:border-primary/20'
      }`}
    >
      {/* Activation surface. Sits under the content so a press on the open
          middle of the card still selects the twin. */}
      <button
        type="button"
        onClick={onActivate}
        aria-label={isActive ? twin.profiles.active : twin.profiles.setActive}
        aria-pressed={isActive}
        className="absolute inset-0 z-0 rounded-card"
      />

      <div className="relative z-10 flex flex-col flex-1 pointer-events-none">
        <div className="flex items-start gap-3 px-4 pt-4">
          <span
            aria-hidden
            className={`w-9 h-9 shrink-0 rounded-card bg-gradient-to-br ${gender.tint} flex items-center justify-center ${gender.color} typo-title-lg`}
          >
            {gender.glyph}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="typo-title-lg truncate">{profile.name}</h3>
            {profile.role ? <p className="typo-caption truncate">{profile.role}</p> : null}
          </div>
          {isActive ? (
            <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-pill bg-primary/10 text-primary typo-label">
              <Check className="w-3 h-3" />
              {twin.profiles.active}
            </span>
          ) : (
            <Tooltip content={twin.profiles.delete} placement="top">
              <button
                type="button"
                onClick={onDelete}
                aria-label={twin.profiles.delete}
                className="pointer-events-auto shrink-0 p-1.5 rounded-interactive text-muted opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-status-error hover:bg-secondary/40"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          )}
        </div>

        {/* Dominant: where this twin speaks. */}
        <div className="px-4 pt-4">
          <TwinChannelMarks
            marks={dash?.channels ?? []}
            onActivate={onActivate}
            onAddChannel={onAddChannel}
          />
        </div>

        {/* The one short line. Readiness is stated here and nowhere else. */}
        <p className="px-4 pt-4 pb-3 mt-auto typo-data text-muted">
          {tx(twin.profiles.readyPercent, { pct: dash?.readiness.score ?? 0 })}
        </p>

        {dash ? <TwinSlotStrip readiness={dash.readiness} onOpenSlot={onOpenSlot} /> : null}
      </div>
    </RevealItem>
  );
}
