// PROTOTYPE VARIANT 2 — "Control Surface".
//
// Metaphor: a technical SPEC readout. The left rail is a dense dimension table
// (label · impact · status dot) you scan like a config; the header is a compact
// metadata chip-bar (schedule / delivery / review / memory) for the active
// capability. Same impact translation as Variant 1, but data-dense and
// engineering-flavoured rather than narrative. Petal mechanism + editor + modals
// are the shared hook — only the SIDEBAR + HEADER + typography differ.
//
// (Prototype: copy is English-literal; i18n at consolidation.)
import { PersonaLayout } from '@/features/shared/glyph/persona-layout';
import { DIM_META } from '@/features/shared/glyph';
import { useTranslation } from '@/i18n/useTranslation';
import { CapabilityTagSwitcher } from './CapabilityTagSwitcher';
import { QuestionnaireStoryThread } from '../questionnaire/QuestionnaireStoryThread';
import { useAdoptionDimensionModel } from './useAdoptionDimensionModel';
import type { DimImpact, ImpactTone } from './adoptionImpact';
import type { GlyphDimension } from '@/features/shared/glyph';
import type { PersonaLayoutAdoptionProps } from './personaLayoutAdoptionTypes';

const DOT: Record<ImpactTone, string> = {
  active: 'bg-status-success',
  muted: 'bg-foreground/25',
  warn: 'bg-status-warning',
};
const VAL: Record<ImpactTone, string> = {
  active: 'text-foreground',
  muted: 'text-foreground/50',
  warn: 'text-status-warning',
};

function SpecRow({ impact, active, onSelect }: { impact: DimImpact; active: boolean; onSelect: (d: GlyphDimension) => void }) {
  const meta = DIM_META[impact.dim];
  const Icon = meta.icon;
  return (
    <button
      type="button"
      onClick={() => onSelect(impact.dim)}
      className={`group grid w-full grid-cols-[16px_72px_1fr_8px] items-center gap-2 rounded-interactive px-2 py-1.5 text-left transition-colors cursor-pointer ${
        active ? 'bg-primary/12 ring-1 ring-primary/40' : 'hover:bg-foreground/[0.04]'
      }`}
    >
      <Icon className="h-3.5 w-3.5" style={{ color: meta.color }} />
      <span className="typo-label uppercase tracking-[0.12em] text-foreground/45 truncate">{impact.label}</span>
      <span className={`typo-caption font-medium leading-tight truncate ${VAL[impact.tone]}`} title={impact.detail ? `${impact.value} — ${impact.detail}` : impact.value}>
        {impact.value}
      </span>
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[impact.tone]}`} />
    </button>
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

export function PersonaLayoutAdoptionVariant2(props: PersonaLayoutAdoptionProps) {
  const { templateName, onToggleUseCase, onClose } = props;
  const { t } = useTranslation();
  const model = useAdoptionDimensionModel(props);
  const byDim = (d: GlyphDimension) => model.dimImpacts.find((i) => i.dim === d);

  const leftSlot = (
    <div className="rounded-card border border-card-border/40 bg-secondary/10 p-2.5">
      <div className="flex items-center justify-between px-1 pb-2">
        <span className="typo-label uppercase tracking-[0.2em] text-foreground/45">Specification</span>
        <span className="typo-caption tabular-nums text-foreground/45">{model.answeredCount}/{model.totalCount}</span>
      </div>
      <div className="flex flex-col gap-0.5">
        {model.dimImpacts.map((impact) => (
          <SpecRow key={impact.dim} impact={impact} active={model.activeDim === impact.dim} onSelect={model.handlePetalClick} />
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
            <HeaderChip impact={byDim('trigger')} />
            <HeaderChip impact={byDim('connector')} />
            <HeaderChip impact={byDim('message')} />
            <HeaderChip impact={byDim('review')} />
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
