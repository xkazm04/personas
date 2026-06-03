import { useMemo } from 'react';
import { Bot, Plus } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { ContentBox } from '@/features/shared/components/layout/ContentLayout';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';

const MAX_RECENT = 5;

/**
 * The editor's no-persona-selected fallback. Replaces the previous bare-icon
 * placeholder with a guided entry point: an accent-tinted glyph, a primary
 * "Create persona" CTA wired to the build wizard (via `setIsCreatingPersona`),
 * and a row of recent-persona chips for one-click resume. The CTA is the first
 * thing a new user sees and the fallback every user hits when a selection fails
 * to load, so it turns dead space into an action.
 */
export function EditorEmptyState() {
  const { t } = useTranslation();
  const labels = t.agents.editor_empty;
  const { personas, selectedPersonaId, selectPersona } = useAgentStore(
    useShallow((s) => ({
      personas: s.personas,
      selectedPersonaId: s.selectedPersonaId,
      selectPersona: s.selectPersona,
    })),
  );
  const setIsCreatingPersona = useSystemStore((s) => s.setIsCreatingPersona);

  // Most-recently-updated personas, excluding the one that failed to load.
  const recent = useMemo(
    () =>
      [...personas]
        .filter((p) => p.id !== selectedPersonaId)
        .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
        .slice(0, MAX_RECENT),
    [personas, selectedPersonaId],
  );

  return (
    <ContentBox>
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          icon={Bot}
          iconColor="text-primary/80"
          iconContainerClassName="bg-primary/10 border-primary/20"
          title={labels.title}
          subtitle={labels.subtitle}
          action={{ label: labels.create, onClick: () => setIsCreatingPersona(true), icon: Plus }}
        >
          {recent.length > 0 && (
            <div className="flex flex-col items-center gap-2">
              <span className="typo-caption text-foreground">{labels.resume_label}</span>
              <div className="flex flex-wrap items-center justify-center gap-2 max-w-[36rem]">
                {recent.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    data-testid={`editor-empty-resume-${p.id}`}
                    onClick={() => selectPersona(p.id)}
                    title={p.name}
                    className="inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full border border-primary/15 bg-secondary/40 hover:bg-primary/10 hover:border-primary/30 transition-colors focus-ring max-w-[12rem]"
                  >
                    <PersonaIcon icon={p.icon} color={p.color} size="w-4 h-4" />
                    <span className="typo-body text-foreground truncate">{p.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </EmptyState>
      </div>
    </ContentBox>
  );
}
