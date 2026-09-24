import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { PersonaResponsibility } from '@/lib/bindings/PersonaResponsibility';
import type { EffortBand } from '@/lib/bindings/EffortBand';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { formatNumeric } from '@/lib/utils/formatters';
import {
  DIFFICULTIES,
  DIFFICULTY_ROUTE,
  EFFORT_BANDS,
  EFFORT_BAND_CODES,
  EFFORT_TOKEN_RANGE,
  EFFORT_UNITS,
  GPU_CLASSES,
  MACHINE_LOADS,
  MACHINE_UNITS,
  MODEL_TIER_NAMES,
  profileDraftOf,
  sameProfileTags,
  specWithResourceProfile,
  type ResourceProfileDraft,
} from '../libs/charterSpec';
import { useCharterMeasured } from '../libs/useCharterMeasured';
import type { CharterPatch } from './sigil/dimEditorShell';

interface CharterResourceCardProps {
  charter: PersonaResponsibility;
  personaId: string;
  onPatch: (patch: CharterPatch) => Promise<void>;
}

interface Choice<T extends string> {
  value: T;
  label: string;
  detail: string;
}

/**
 * One single-select tag picker. A radio group, not a tab strip: there is no
 * panel behind a choice, and the pill matches `ChipToggleList` — the
 * multi-select affordance the sibling editors use — so the card reads as the
 * same system with `aria-checked` in place of `aria-pressed`.
 */
function TagPicker<T extends string>({
  label,
  hint,
  choices,
  value,
  muted,
  onChange,
  testId,
}: {
  label: string;
  hint?: ReactNode;
  choices: Choice<T>[];
  value: T;
  muted: boolean;
  onChange: (next: T) => void;
  testId: string;
}) {
  return (
    <div className="flex flex-col gap-1.5" data-testid={testId}>
      <span className="typo-label text-foreground">{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        className={`flex flex-wrap gap-1.5 ${muted ? 'opacity-60' : ''}`}
      >
        {choices.map((c) => {
          const active = c.value === value;
          return (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(c.value)}
              className={`flex flex-col items-start px-2.5 py-1 rounded-interactive border text-left transition-colors focus-ring ${
                active
                  ? 'bg-primary/15 border-primary/40 text-primary'
                  : 'bg-secondary/30 border-primary/10 text-foreground/85 hover:border-primary/25'
              }`}
              data-testid={`${testId}-${c.value}`}
            >
              <span className="typo-body">{c.label}</span>
              <span className="typo-caption text-foreground tabular-nums">{c.detail}</span>
            </button>
          );
        })}
      </div>
      {hint && <p className="typo-caption text-foreground">{hint}</p>}
    </div>
  );
}

/**
 * The charter's resource profile: what a run is charged as at fleet admission
 * (machine, GPU, plan effort) and which model tier its difficulty routes to —
 * shown beside what runs have actually measured.
 *
 * The persona declares it; the operator can overrule and pin it. Editing any
 * tag pins the draft, because an unpinned operator edit is one the persona
 * overwrites on its next decide wake. Provenance is the server's to stamp —
 * see `specWithResourceProfile`.
 */
export function CharterResourceCard({ charter, personaId, onPatch }: CharterResourceCardProps) {
  const { t, tx, language } = useTranslation();
  const c = t.agents.responsibilities;
  const stored = charter.spec.resourceProfile ?? null;
  const saved = useMemo(() => profileDraftOf(charter.spec), [charter.spec]);
  // `null` = untouched: the card follows `saved` (so a persona declaration that
  // lands through a reload is shown) until the operator changes something.
  const [edit, setEdit] = useState<ResourceProfileDraft | null>(null);
  const draft = edit ?? saved;
  const dirty = !!edit && (!sameProfileTags(edit, saved) || edit.pinned !== saved.pinned);
  const untagged = !stored && !dirty;

  const setTag = (patch: Partial<ResourceProfileDraft>) => setEdit({ ...draft, ...patch, pinned: true });

  const units = (n: number) => tx(c.profile_units, { count: formatNumeric(n, 'count', { language }) });
  const compact = (n: number) => formatNumeric(n, 'compact', { language });
  const tokenRange = (band: EffortBand): string => {
    const { from, to } = EFFORT_TOKEN_RANGE[band];
    if (from == null && to != null) return tx(c.profile_tokens_under, { to: compact(to) });
    if (from != null && to == null) return tx(c.profile_tokens_over, { from: compact(from) });
    return tx(c.profile_tokens_between, { from: compact(from ?? 0), to: compact(to ?? 0) });
  };

  const machineLabels = {
    light: c.profile_machine_light,
    moderate: c.profile_machine_moderate,
    heavy: c.profile_machine_heavy,
    exclusive: c.profile_machine_exclusive,
  };
  const gpuLabels = {
    none: c.profile_gpu_none,
    shared: c.profile_gpu_shared,
    exclusive: c.profile_gpu_exclusive,
  };
  const gpuDetails = {
    none: c.profile_gpu_none_detail,
    shared: c.profile_gpu_shared_detail,
    exclusive: c.profile_gpu_exclusive_detail,
  };
  const difficultyLabels = {
    light: c.profile_difficulty_light,
    standard: c.profile_difficulty_standard,
    hard: c.profile_difficulty_hard,
  };
  const reasoningLabels = { low: c.profile_effort_low, medium: c.profile_effort_medium, high: c.profile_effort_high };
  const routeOf = (d: keyof typeof DIFFICULTY_ROUTE) =>
    tx(c.profile_route_pair, {
      model: MODEL_TIER_NAMES[DIFFICULTY_ROUTE[d].model],
      effort: reasoningLabels[DIFFICULTY_ROUTE[d].effort],
    });

  let chip: ReactNode;
  if (dirty) {
    chip = <StatusBadge size="sm" variant="warning">{c.profile_source_unsaved}</StatusBadge>;
  } else if (!stored) {
    chip = <StatusBadge size="sm" accent="slate">{c.profile_source_default}</StatusBadge>;
  } else if (stored.pinned) {
    chip = <StatusBadge size="sm" accent="violet">{c.profile_source_pinned}</StatusBadge>;
  } else if (stored.source === 'self') {
    chip = (
      <Tooltip content={stored.rationale || c.profile_no_rationale}>
        <span className="inline-flex items-center gap-1.5">
          <StatusBadge size="sm" accent="cyan">{c.profile_source_self}</StatusBadge>
          {stored.declaredAt && (
            <RelativeTime timestamp={stored.declaredAt} className="typo-caption text-foreground" />
          )}
        </span>
      </Tooltip>
    );
  } else {
    chip = <StatusBadge size="sm" accent="slate">{c.profile_source_operator}</StatusBadge>;
  }

  return (
    <SectionCard title={c.profile_title} action={<span data-testid="resp-profile-source">{chip}</span>}>
      <div className="flex flex-col gap-4" data-testid="resp-profile">
        <p className="typo-caption text-foreground">{c.profile_hint}</p>
        {untagged && (
          <p className="typo-caption text-foreground" data-testid="resp-profile-untagged">
            {c.profile_untagged_note}
          </p>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <TagPicker
            label={c.profile_machine_label}
            choices={MACHINE_LOADS.map((v) => ({ value: v, label: machineLabels[v], detail: units(MACHINE_UNITS[v]) }))}
            value={draft.machine}
            muted={untagged}
            onChange={(machine) => setTag({ machine })}
            testId="resp-profile-machine"
          />
          <TagPicker
            label={c.profile_gpu_label}
            choices={GPU_CLASSES.map((v) => ({ value: v, label: gpuLabels[v], detail: gpuDetails[v] }))}
            value={draft.gpu}
            muted={untagged}
            onChange={(gpu) => setTag({ gpu })}
            testId="resp-profile-gpu"
          />
          <TagPicker
            label={c.profile_difficulty_label}
            hint={tx(c.profile_difficulty_route_hint, { route: routeOf(draft.difficulty) })}
            choices={DIFFICULTIES.map((v) => ({ value: v, label: difficultyLabels[v], detail: routeOf(v) }))}
            value={draft.difficulty}
            muted={untagged}
            onChange={(difficulty) => setTag({ difficulty })}
            testId="resp-profile-difficulty"
          />
          <TagPicker
            label={c.profile_effort_label}
            hint={tx(c.profile_effort_plan_hint, { units: units(EFFORT_UNITS[draft.effort]) })}
            choices={EFFORT_BANDS.map((v) => ({ value: v, label: EFFORT_BAND_CODES[v], detail: tokenRange(v) }))}
            value={draft.effort}
            muted={untagged}
            onChange={(effort) => setTag({ effort })}
            testId="resp-profile-effort"
          />
        </div>

        <MeasuredRow
          personaId={personaId}
          charterId={charter.id}
          declared={draft.effort}
        />

        <div className="flex items-start gap-3 border-t border-border/60 pt-3">
          <AccessibleToggle
            checked={draft.pinned}
            onChange={() => setEdit({ ...draft, pinned: !draft.pinned })}
            label={c.profile_pin_label}
            size="sm"
            data-testid="resp-profile-pin"
          />
          <div className="min-w-0 flex-1">
            <div className="typo-body text-foreground">{c.profile_pin_label}</div>
            <p className="typo-caption text-foreground">
              {draft.pinned ? c.profile_pin_on_hint : c.profile_pin_off_hint}
            </p>
          </div>
          <AsyncButton
            size="xs"
            variant="primary"
            disabled={!dirty}
            onClick={async () => {
              await onPatch({ spec: specWithResourceProfile(charter.spec, draft) });
              setEdit(null);
            }}
            data-testid="resp-profile-save"
          >
            {t.common.save}
          </AsyncButton>
        </div>
      </div>
    </SectionCard>
  );
}

/** Declared vs measured. Static label chrome always renders; the ghost sits
 *  under it only while the first fetch for this persona is in flight. */
function MeasuredRow({
  personaId,
  charterId,
  declared,
}: {
  personaId: string;
  charterId: string;
  declared: EffortBand;
}) {
  const { t, tx, language } = useTranslation();
  const c = t.agents.responsibilities;
  const { measured, isLoading } = useCharterMeasured(personaId, charterId);
  const band = measured?.measuredEffort ?? null;
  const mismatch = band != null && band !== declared;

  return (
    <div
      className={`rounded-card border px-3 py-2 flex flex-col gap-1.5 ${
        mismatch ? 'border-status-warning/40 bg-status-warning/10' : 'border-primary/10 bg-secondary/20'
      }`}
      data-testid="resp-profile-measured"
      data-mismatch={mismatch ? 'true' : 'false'}
    >
      <span className="typo-label text-foreground">{c.profile_measured_label}</span>
      {isLoading ? (
        <div className="h-4 w-2/3 rounded-interactive bg-secondary/40" aria-hidden="true" data-testid="resp-profile-measured-ghost" />
      ) : band == null || !measured ? (
        <Tooltip content={c.profile_not_measured_tooltip}>
          <span className="typo-caption text-foreground" data-testid="resp-profile-not-measured">
            {measured && measured.passes > 0
              ? tx(c.profile_not_measured_passes, { passes: formatNumeric(measured.passes, 'count', { language }) })
              : c.profile_not_measured}
          </span>
        </Tooltip>
      ) : (
        <>
          <dl className="flex flex-wrap gap-x-5 gap-y-1 typo-caption text-foreground">
            <div className="flex gap-1.5">
              <dt className="text-foreground">{c.profile_measured_passes}</dt>
              <dd><Numeric value={measured.passes} unit="count" /></dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-foreground">{c.profile_measured_cost}</dt>
              <dd><Numeric value={measured.avgCostUsd} unit="usd" /></dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-foreground">{c.profile_measured_tokens}</dt>
              <dd><Numeric value={measured.avgTokens} unit="compact" /></dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-foreground">{c.profile_measured_band}</dt>
              <dd className={mismatch ? 'text-status-warning' : undefined} data-testid="resp-profile-measured-band">
                {EFFORT_BAND_CODES[band]}
              </dd>
            </div>
          </dl>
          {mismatch && (
            <p className="typo-caption text-status-warning" data-testid="resp-profile-mismatch">
              {tx(c.profile_mismatch_line, {
                measured: EFFORT_BAND_CODES[band],
                passes: formatNumeric(measured.passes, 'count', { language }),
                declared: EFFORT_BAND_CODES[declared],
              })}
            </p>
          )}
        </>
      )}
    </div>
  );
}
