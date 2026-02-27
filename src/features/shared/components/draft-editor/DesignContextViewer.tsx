import { useState, useMemo } from 'react';
import { Eye, Pencil, Link } from 'lucide-react';
import { parseDesignContext } from '@/features/shared/components/UseCasesList';
import { UseCasesList } from '@/features/shared/components/UseCasesList';
import { usePersonaStore } from '@/stores/personaStore';
import { SectionEditor } from './SectionEditor';

interface DesignContextViewerProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function DesignContextViewer({ value, onChange, disabled }: DesignContextViewerProps) {
  const [mode, setMode] = useState<'structured' | 'raw'>('structured');
  const contextData = useMemo(() => parseDesignContext(value), [value]);
  const credentials = usePersonaStore((s) => s.credentials);

  const hasStructuredData = Boolean(contextData.summary || (contextData.useCases && contextData.useCases.length > 0));
  const credentialLinks = contextData.credentialLinks ?? {};
  const linkEntries = Object.entries(credentialLinks);

  // If no structured data, fall back to SectionEditor
  if (!hasStructuredData && !linkEntries.length) {
    return (
      <SectionEditor
        value={value}
        onChange={onChange}
        label="Design Context"
        placeholder="Additional context about how this persona was designed..."
        disabled={disabled}
      />
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header with label and toggle */}
      <div className="flex items-center justify-between px-1 pb-2 flex-shrink-0">
        <span className="text-sm font-medium text-foreground/80">Design Context</span>
        <div className="flex gap-0.5 p-0.5 rounded-lg bg-secondary/30 border border-primary/10">
          <button
            onClick={() => setMode('structured')}
            className={`flex items-center gap-1 px-2 py-1 text-sm rounded-md transition-colors ${
              mode === 'structured'
                ? 'bg-primary/15 text-foreground/80 font-medium'
                : 'text-muted-foreground/90 hover:text-muted-foreground'
            }`}
          >
            <Eye className="w-3 h-3" />
            View
          </button>
          <button
            onClick={() => setMode('raw')}
            className={`flex items-center gap-1 px-2 py-1 text-sm rounded-md transition-colors ${
              mode === 'raw'
                ? 'bg-primary/15 text-foreground/80 font-medium'
                : 'text-muted-foreground/90 hover:text-muted-foreground'
            }`}
          >
            <Pencil className="w-3 h-3" />
            Edit Raw
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 rounded-xl border border-primary/15 overflow-hidden">
        {mode === 'raw' ? (
          <SectionEditor
            value={value}
            onChange={onChange}
            label=""
            placeholder="Design context JSON..."
            disabled={disabled}
          />
        ) : (
          <div className="h-full overflow-y-auto px-4 py-3 bg-background/30 space-y-5">
            {/* Summary */}
            {contextData.summary && (
              <div>
                <p className="text-sm font-semibold text-muted-foreground/55 uppercase tracking-wider mb-2">
                  Summary
                </p>
                <p className="text-sm text-foreground/80 leading-relaxed">
                  {contextData.summary}
                </p>
              </div>
            )}

            {/* Use Cases */}
            {contextData.useCases && contextData.useCases.length > 0 && (
              <div>
                <UseCasesList designContext={value} />
              </div>
            )}

            {/* Credential Links */}
            {linkEntries.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2 px-1">
                  <Link className="w-3.5 h-3.5 text-muted-foreground/80" />
                  <p className="text-sm font-semibold text-muted-foreground/55 uppercase tracking-wider">
                    Credential Links
                  </p>
                </div>
                <div className="space-y-1.5">
                  {linkEntries.map(([connName, credId]) => {
                    const cred = credentials.find((c) => c.id === credId);
                    return (
                      <div
                        key={connName}
                        className="flex items-center justify-between px-3 py-2 rounded-lg border border-primary/10 bg-secondary/20"
                      >
                        <span className="text-sm font-mono text-foreground/70">{connName}</span>
                        <span className="text-sm text-muted-foreground/60">
                          {cred ? cred.name : credId.slice(0, 8) + '...'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
