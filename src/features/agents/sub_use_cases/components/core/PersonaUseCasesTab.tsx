import { useState } from 'react';
import { PersonaUseCasesTabGrid } from './PersonaUseCasesTabGrid';
import { PersonaUseCasesTabGlyph } from './PersonaUseCasesTabGlyph';
import type { PersonaDraft } from '@/features/agents/sub_editor';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';

interface PersonaUseCasesTabProps {
  draft: PersonaDraft;
  patch: (updates: Partial<PersonaDraft>) => void;
  modelDirty: boolean;
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
}

type View = 'grid' | 'glyph';
const VIEW_STORAGE_KEY = 'personas:use-cases-view';

function readView(): View {
  try {
    const raw = localStorage.getItem(VIEW_STORAGE_KEY);
    if (raw === 'grid' || raw === 'glyph') return raw;
  } catch { /* ignore */ }
  return 'grid';
}

function writeView(v: View): void {
  try { localStorage.setItem(VIEW_STORAGE_KEY, v); } catch { /* ignore */ }
}

export function PersonaUseCasesTab(props: PersonaUseCasesTabProps) {
  const [view, setView] = useState<View>(readView);
  const handleChange = (next: View) => {
    setView(next);
    writeView(next);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-end mb-2 flex-shrink-0">
        <div className="inline-flex rounded-full border border-border/30 bg-secondary/20 p-0.5">
          <button
            type="button"
            onClick={() => handleChange('grid')}
            className={`rounded-full px-3 py-1 typo-caption transition ${
              view === 'grid'
                ? 'bg-primary/20 text-primary'
                : 'text-foreground/60 hover:text-foreground'
            }`}
          >
            Grid
          </button>
          <button
            type="button"
            onClick={() => handleChange('glyph')}
            className={`rounded-full px-3 py-1 typo-caption transition ${
              view === 'glyph'
                ? 'bg-primary/20 text-primary'
                : 'text-foreground/60 hover:text-foreground'
            }`}
            title="Glyph — sigil-first capability view"
          >
            Glyph
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {view === 'glyph' ? <PersonaUseCasesTabGlyph {...props} /> : <PersonaUseCasesTabGrid {...props} />}
      </div>
    </div>
  );
}
