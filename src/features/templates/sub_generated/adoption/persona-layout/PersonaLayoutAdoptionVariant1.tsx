// PROTOTYPE VARIANT 1 — "Briefing".
//
// Metaphor: the left rail is a plain-language BRIEFING of what the persona will
// actually do — one impact sentence per dimension ("Runs daily at 9:00",
// "Memory activated", "Reports to Slack + inbox"), not raw on/off toggles. The
// header reads as an editorial "what this does" band. Petal mechanism, sigil,
// editor overlay, and picker modals are unchanged (shared hook) — this variant
// only re-imagines the SIDEBAR + HEADER + typography, per the brief.
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

const TONE_TEXT: Record<ImpactTone, string> = {
  active: 'text-foreground',
  muted: 'text-foreground/55',
  warn: 'text-status-warning',
};

function BriefingRow({ impact, active, onSelect }: { impact: DimImpact; active: boolean; onSelect: (d: GlyphDimension) => void }) {
  const meta = DIM_META[impact.dim];
  const Icon = meta.icon;
  return (
    <button
      type="button"
      onClick={() => onSelect(impact.dim)}
      className={`group w-full text-left rounded-card border px-3 py-2.5 transition-all cursor-pointer ${
        active
          ? 'border-primary/55 bg-primary/10'
          : 'border-card-border/40 bg-secondary/15 hover:border-card-border/70 hover:bg-secondary/25'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span
          className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-interactive"
          style={{ backgroundColor: `${meta.color}1f`, color: meta.color }}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="typo-label uppercase tracking-[0.16em] text-foreground/45">{impact.label}</div>
          <div className={`typo-body font-medium leading-snug ${TONE_TEXT[impact.tone]}`}>{impact.value}</div>
          {impact.detail && (
            <div className="typo-caption text-foreground/55 mt-0.5 truncate">{impact.detail}</div>
          )}
        </div>
      </div>
    </button>
  );
}

export function PersonaLayoutAdoptionVariant1(props: PersonaLayoutAdoptionProps) {
  const { templateName, onToggleUseCase, onClose } = props;
  const { t } = useTranslation();
  const model = useAdoptionDimensionModel(props);

  const leftSlot = (
    <div className="flex flex-col gap-3">
      <div className="px-1">
        <div className="typo-label uppercase tracking-[0.2em] text-foreground/45">Briefing</div>
        <p className="typo-caption text-foreground/60 mt-0.5">What this persona will do once adopted.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        {model.dimImpacts.map((impact) => (
          <BriefingRow
            key={impact.dim}
            impact={impact}
            active={model.activeDim === impact.dim}
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
        <div className="rounded-card border border-card-border/40 bg-gradient-to-b from-secondary/20 to-secondary/5 px-4 py-3.5">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="typo-heading text-foreground">{model.activeUc.title}</h3>
            {model.totalCount > 0 && (
              <span className="typo-caption tabular-nums text-foreground/55 shrink-0">
                {model.answeredCount}/{model.totalCount} configured
              </span>
            )}
          </div>
          {model.activeUc.description && (
            <p className="typo-body font-serif text-foreground/90 mt-1.5 leading-relaxed">
              {model.activeUc.description}
            </p>
          )}
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
