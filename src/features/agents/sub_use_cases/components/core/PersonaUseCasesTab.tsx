import { useEffect, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { RecipesVariantSigilGrid } from '../recipes-prototype/RecipesVariantSigilGrid';
import { ConsolidatedSigilLayout } from '../consolidated-prototype';
import type { PersonaDraft } from '@/features/agents/sub_editor';
import type { CredentialMetadata } from '@/lib/types/types';

interface PersonaUseCasesTabProps {
  draft: PersonaDraft;
  patch: (updates: Partial<PersonaDraft>) => void;
  modelDirty: boolean;
  credentials: CredentialMetadata[];
}

type UseCasesLayout = 'sigil-grid' | 'consolidated';
const LAYOUT_STORAGE_KEY = 'personas:use-cases-layout';

function readLayout(): UseCasesLayout {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (raw === 'sigil-grid' || raw === 'consolidated') return raw;
  } catch {
    /* SSR or disabled localStorage */
  }
  return 'sigil-grid';
}

function writeLayout(value: UseCasesLayout): void {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, value);
  } catch {
    /* best-effort */
  }
}

/**
 * Persona editor → Use Cases tab. Hosts a layout switcher above the
 * canonical RecipesVariantSigilGrid surface; the second option is the
 * Consolidated prototype (persona-level hero + capability rows) used to
 * validate the persona-hero + use-case-grid shape before applying it to
 * adoption and build flows. See docs/concepts/glyph-consolidation.md.
 */
export function PersonaUseCasesTab(props: PersonaUseCasesTabProps) {
  const [layout, setLayout] = useState<UseCasesLayout>(() => readLayout());
  useEffect(() => {
    writeLayout(layout);
  }, [layout]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <LayoutSwitcher value={layout} onChange={setLayout} />
      <div className="flex-1 min-h-0">
        {layout === 'sigil-grid' ? (
          <RecipesVariantSigilGrid {...props} />
        ) : (
          <ConsolidatedSigilLayout credentials={props.credentials} />
        )}
      </div>
    </div>
  );
}

interface LayoutSwitcherProps {
  value: UseCasesLayout;
  onChange: (next: UseCasesLayout) => void;
}

function LayoutSwitcher({ value, onChange }: LayoutSwitcherProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 px-4 pt-3 pb-2 shrink-0">
      <span className="typo-label uppercase tracking-[0.18em] text-foreground/55">
        {t.agents.use_cases.layout_tab_label}
      </span>
      <div
        role="tablist"
        className="inline-flex items-center rounded-full border border-card-border bg-secondary/40 p-0.5"
      >
        <LayoutTab
          active={value === 'sigil-grid'}
          onClick={() => onChange('sigil-grid')}
        >
          {t.agents.use_cases.layout_tab_sigil_grid}
        </LayoutTab>
        <LayoutTab
          active={value === 'consolidated'}
          onClick={() => onChange('consolidated')}
        >
          {t.agents.use_cases.layout_tab_consolidated}
          <span className="ml-1.5 typo-label uppercase tracking-wider text-primary/85">
            {t.agents.use_cases.layout_tab_prototype_badge}
          </span>
        </LayoutTab>
      </div>
    </div>
  );
}

interface LayoutTabProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function LayoutTab({ active, onClick, children }: LayoutTabProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative inline-flex items-center px-3 py-1 rounded-full typo-caption transition-colors cursor-pointer ${
        active
          ? 'bg-primary/20 text-foreground'
          : 'text-foreground/65 hover:text-foreground hover:bg-secondary/60'
      }`}
    >
      {children}
    </button>
  );
}
