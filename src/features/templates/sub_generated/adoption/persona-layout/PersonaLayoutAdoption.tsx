// Adoption "persona layout" surface — the body of the Adopt Template modal.
//
// Consolidated from the /prototype round: the "Control Surface" direction won.
// Left rail is a symbolic icon QUICK-ACTION panel (one petal per icon, state
// shown by colour/fill, label + impact on hover) — a control board you read at
// a glance, not a wall of text. Header is a spec band + metadata chip-bar.
// Orchestration (petal states, question filtering, consistent inline editor,
// picker modals) lives in useAdoptionDimensionModel so the mechanism is one
// source of truth.
import { useTranslation } from '@/i18n/useTranslation';
import { PersonaLayout } from '@/features/shared/glyph/persona-layout';
import { DIM_META, GLYPH_DIMENSIONS } from '@/features/shared/glyph';
import type { GlyphDimension } from '@/features/shared/glyph';
import type { PetalState } from '@/features/shared/glyph/persona-sigil';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { ConnectorIcon, getConnectorMeta } from '@/lib/connectors/connectorMeta';
import { CapabilityTagSwitcher } from './CapabilityTagSwitcher';
import { QuestionnaireStoryThread } from '../questionnaire/QuestionnaireStoryThread';
import { useAdoptionDimensionModel } from './useAdoptionDimensionModel';
import type { DimImpact, ImpactTone } from './adoptionImpact';
import type { PersonaLayoutAdoptionProps } from './personaLayoutAdoptionTypes';

const VAL: Record<ImpactTone, string> = {
  active: 'text-foreground',
  muted: 'text-foreground/50',
  warn: 'text-status-warning',
};

const STATE_PIP: Record<PetalState, string> = {
  resolved: 'bg-status-success',
  filling: 'bg-primary',
  pending: 'bg-status-warning',
  error: 'bg-status-error',
  idle: 'bg-foreground/25',
};

/**
 * One row in the left quick-action rail: the symbolic petal icon (state by
 * colour/fill + status pip) plus a fixed-width info box that surfaces the
 * petal's *resolved value at a glance* — connector brand icons for Apps, the
 * schedule shortcut for When, "Activated" for Memory/Review, etc. The whole
 * row is clickable and routes to the petal's action.
 */
function PetalRow({
  dim, state, active, impact, info, onSelect,
}: {
  dim: GlyphDimension;
  state: PetalState;
  active: boolean;
  impact: DimImpact | undefined;
  info: React.ReactNode;
  onSelect: (d: GlyphDimension) => void;
}) {
  const meta = DIM_META[dim];
  const Icon = meta.icon;
  const lit = state === 'resolved' || state === 'filling';
  const tip = impact ? `${impact.label} — ${impact.value}${impact.detail ? `\n${impact.detail}` : ''}` : impact;

  return (
    <Tooltip content={tip ?? meta.labelKey} placement="right">
      <button
        type="button"
        onClick={() => onSelect(dim)}
        aria-label={impact?.label ?? dim}
        className={`group flex w-full items-center gap-2 rounded-card transition-all cursor-pointer ${
          active ? 'ring-2 ring-primary/40' : ''
        }`}
      >
        <span
          className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-card border transition-all ${
            active
              ? 'border-primary/70'
              : state === 'pending'
                ? 'border-status-warning/55'
                : lit
                  ? 'border-card-border/40'
                  : 'border-card-border/25'
          }`}
          style={lit ? { backgroundColor: `${meta.color}1c` } : undefined}
        >
          <Icon
            className={`h-5 w-5 transition-opacity ${lit ? '' : 'opacity-40'}`}
            style={lit ? { color: meta.color } : undefined}
          />
          <span className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-card-bg ${STATE_PIP[state]}`} />
        </span>
        {/* Fixed-width info box — flex-1 fills the fixed-width rail so every
            row's box aligns. Bordered only when it carries content. */}
        <span
          className={`flex h-11 min-w-0 flex-1 items-center gap-1 overflow-hidden rounded-card px-2 ${
            info ? 'border border-card-border/30 bg-secondary/20' : 'border border-transparent'
          }`}
        >
          {info}
        </span>
      </button>
    </Tooltip>
  );
}

function HeaderChip({ impact }: { impact: DimImpact | undefined }) {
  if (!impact) return null;
  const meta = DIM_META[impact.dim];
  const Icon = meta.icon;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-interactive border border-card-border/50 bg-secondary/25 px-2 py-1">
      <Icon className="h-3 w-3" style={{ color: meta.color }} />
      <span className={`typo-caption font-medium ${VAL[impact.tone]}`}>{impact.value}</span>
    </span>
  );
}

export function PersonaLayoutAdoption(props: PersonaLayoutAdoptionProps) {
  const { templateName, onToggleUseCase, onClose } = props;
  const { t } = useTranslation();
  const model = useAdoptionDimensionModel(props);
  const impactByDim = (d: GlyphDimension) => model.dimImpacts.find((i) => i.dim === d);

  // The right-hand info box per petal row — its resolved value at a glance.
  // Apps → connector brand icons; Memory/Review → "Activated"/empty; everything
  // else → the impact sentence (schedule shortcut, event count, escalation…).
  const infoForDim = (dim: GlyphDimension): React.ReactNode => {
    if (dim === 'connector') {
      const cons = model.connectorsForActive;
      if (cons.length === 0) return null;
      const shown = cons.slice(0, 4);
      return (
        <>
          {shown.map((c) => (
            <ConnectorIcon key={c.key ?? c.label} meta={getConnectorMeta(c.key ?? c.label)} size="w-4 h-4" />
          ))}
          {cons.length > 4 && (
            <span className="typo-caption tabular-nums text-foreground/55">+{cons.length - 4}</span>
          )}
        </>
      );
    }
    if (dim === 'memory' || dim === 'review') {
      return model.petalStates[dim] === 'resolved' ? (
        <span className="typo-caption truncate text-status-success">
          {t.templates.adopt_modal.persona_layout_rail_activated}
        </span>
      ) : null;
    }
    const imp = impactByDim(dim);
    if (imp && imp.tone !== 'muted') {
      return <span className={`typo-caption truncate ${VAL[imp.tone]}`}>{imp.value}</span>;
    }
    return null;
  };

  // Left rail — symbolic petal switches. Each icon's colour/fill encodes the
  // dimension's state (lit = configured/on, pip = success/pending/idle); click
  // routes to the petal's action (toggle for memory/review, editor/picker for
  // the rest); the words live in the hover tooltip.
  const leftSlot = (
    <div className="flex flex-col gap-3">
      <div className="flex w-full items-center justify-between px-0.5">
        <span className="typo-label uppercase tracking-[0.2em] text-foreground/45">Petals</span>
        <span className="typo-caption tabular-nums text-foreground/45">{model.answeredCount}/{model.totalCount}</span>
      </div>
      <div className="flex flex-col gap-2">
        {GLYPH_DIMENSIONS.map((dim) => (
          <PetalRow
            key={dim}
            dim={dim}
            state={model.petalStates[dim]}
            active={model.activeDim === dim}
            impact={impactByDim(dim)}
            info={infoForDim(dim)}
            onSelect={model.handlePetalClick}
          />
        ))}
      </div>
    </div>
  );

  const rightSlot = (
    <QuestionnaireStoryThread
      questions={model.filteredQuestions}
      userAnswers={props.userAnswers}
      activeIdx={model.activeStoryIdx}
      autoDetectedIds={props.autoDetectedIds}
      blockedQuestionIds={props.blockedQuestionIds}
      answeredCount={model.answeredCount}
      totalCount={model.totalCount}
      onJumpTo={model.handleStoryJumpTo}
      fill
    />
  );

  const topSlot = model.items.length > 0 ? (
    <div className="flex flex-col gap-3">
      <CapabilityTagSwitcher
        items={model.perCapability}
        activeId={model.activeCapabilityId}
        onActiveChange={model.handleActiveCapChange}
        onToggleEnabled={onToggleUseCase}
      />
      {model.activeUc && (
        <div className="rounded-card border border-card-border/40 bg-secondary/12 px-4 py-3">
          <h3 className="typo-heading text-foreground">{model.activeUc.title}</h3>
          {model.activeUc.description && (
            <p className="typo-body text-foreground/85 mt-1 leading-relaxed">{model.activeUc.description}</p>
          )}
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <HeaderChip impact={impactByDim('trigger')} />
            <HeaderChip impact={impactByDim('connector')} />
            <HeaderChip impact={impactByDim('message')} />
            <HeaderChip impact={impactByDim('review')} />
          </div>
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0">
        <PersonaLayout
          mode="adoption"
          personaName={templateName}
          items={model.items}
          onRowOpen={() => { /* in-card answering covers per-question flow */ }}
          onRowToggle={(uc) => onToggleUseCase(uc.id)}
          topSlot={topSlot}
          leftSlot={leftSlot}
          rightSlot={rightSlot}
          hideMetadataBand
          hideCapabilityRows={model.items.length > 0}
          sigilSizeScale={0.8}
          heroPetalStatesOverride={model.petalStates}
          onHeroPetalClick={model.handlePetalClick}
          heroActiveDim={model.activeDim}
          heroCenterOverlay={model.centerOverlay}
          heroWideOverlay={model.wideOverlay}
          emptyNode={
            <div className="rounded-modal border border-card-border bg-secondary/30 p-8 text-center">
              <span className="typo-body text-foreground italic">
                {t.templates.adopt_modal.persona_layout_no_capabilities}
              </span>
            </div>
          }
        />
      </div>
      <div className="shrink-0 border-t border-border bg-foreground/[0.02] px-5 py-3 flex items-center gap-3">
        <button type="button" onClick={onClose} className="typo-caption text-foreground hover:text-foreground transition-colors cursor-pointer">
          {t.templates.adopt_modal.cancel}
        </button>
      </div>
      {model.pickerModals}
    </div>
  );
}
