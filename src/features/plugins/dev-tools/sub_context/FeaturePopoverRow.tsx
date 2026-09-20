// One feature inside the ledger's feature popover: what it is, how far across
// the map it reaches, where its council stands, and the one action that state
// offers.
import { useState } from 'react';

import { setUseCaseTier, type UseCaseTier } from '@/api/devTools/council';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';
import type { DevUseCase } from '@/lib/bindings/DevUseCase';
import { interpolate } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';

import type { TDevTools } from './contextLedgerShared';
import {
  CouncilGlyph,
  councilCta,
  councilCtaLabel,
  toCouncilState,
  type CouncilCtaKind,
  type CouncilGlyphKind,
} from './councilGlyph';

export interface FeatureRowModel {
  uc: DevUseCase;
  subject: CouncilSubjectState | null;
  /** A `/council` session is live for this subject right now. */
  running: boolean;
  /** How many context groups the linked contexts belong to. */
  groupCount: number;
}

/** The glyph kind for a row: a live session wins over whatever is stored. */
export function rowGlyphKind(row: FeatureRowModel): CouncilGlyphKind | null {
  if (row.running) return 'running';
  if (!row.subject) return 'none';
  return toCouncilState(row.subject.state);
}

export function FeaturePopoverRow({
  row,
  t,
  onDispatch,
  onTierChanged,
}: {
  row: FeatureRowModel;
  t: TDevTools;
  /** Open the consent surface for this subject's next round. */
  onDispatch: (row: FeatureRowModel) => void;
  onTierChanged: () => void;
}) {
  const kind = rowGlyphKind(row);
  const cta: CouncilCtaKind = councilCta(kind);
  const roundNo = row.subject?.roundNo ?? null;
  const storedTier = row.subject?.tier ?? row.uc.tier;
  const [tier, setTier] = useState<string | null>(storedTier);
  const isMajor = tier === 'major';

  const applyTier = async (next: UseCaseTier) => {
    const previous = tier;
    if (previous === next) return;
    setTier(next); // optimistic
    try {
      await setUseCaseTier(row.uc.id, next);
      onTierChanged();
    } catch (err) {
      setTier(previous); // rollback — the store never moved
      toastCatch('council tier')(err);
    }
  };

  return (
    <li className="flex items-center gap-2 px-3 py-2 border-b border-primary/5 last:border-b-0">
      <CouncilGlyph kind={kind} t={t} />

      <span className="flex flex-col min-w-0 flex-1">
        <span className="typo-body text-foreground truncate">{row.uc.name}</span>
        <span className="typo-caption text-foreground tabular-nums">
          {interpolate(t.council_span, {
            contexts: row.uc.context_ids.length,
            groups: row.groupCount,
          })}
          {roundNo != null && roundNo > 1 && (
            <span className="ml-1.5 px-1 rounded-interactive bg-secondary/40 text-foreground">
              {interpolate(t.council_round, { round: roundNo })}
            </span>
          )}
        </span>
      </span>

      <Tooltip content={interpolate(t.council_tier_toggle_label, { name: row.uc.name })}>
        <span className="inline-flex items-center gap-1.5 shrink-0">
          <span className="typo-caption text-foreground">{t.council_tier_major}</span>
          <AccessibleToggle
            checked={isMajor}
            onChange={() => void applyTier(isMajor ? 'standard' : 'major')}
            label={interpolate(t.council_tier_toggle_label, { name: row.uc.name })}
            size="sm"
          />
        </span>
      </Tooltip>

      {/* Stage 1 has no decision surface, so `ready` points at the report the
          skill wrote rather than offering a gate that does not exist yet. */}
      {cta === 'awaiting' && (
        <Tooltip
          content={interpolate(t.council_report_path, {
            path: row.subject?.runDir ?? t.council_report_path_unknown,
          })}
        >
          <span className="shrink-0 typo-caption text-primary">{councilCtaLabel(cta, t)}</span>
        </Tooltip>
      )}

      {(cta === 'run' || cta === 'next_round') && (
        <AsyncButton
          variant="secondary"
          size="sm"
          className="shrink-0"
          onClick={async () => onDispatch(row)}
        >
          {councilCtaLabel(cta, t)}
        </AsyncButton>
      )}

      {cta === 'promote' && (
        <AsyncButton
          variant="secondary"
          size="sm"
          className="shrink-0"
          onClick={() => applyTier('major')}
        >
          {councilCtaLabel(cta, t)}
        </AsyncButton>
      )}
    </li>
  );
}
