import { useMemo } from 'react';
import { ListChecks } from 'lucide-react';

export interface UseCaseItem {
  id: string;
  title: string;
  description: string;
  category?: string;
}

export interface DesignContextData {
  summary?: string;
  use_cases?: UseCaseItem[];
  credential_links?: Record<string, string>; // connector_name → credential_id
}

const CATEGORY_STYLES: Record<string, { bg: string; text: string }> = {
  notification:   { bg: 'bg-rose-500/10 border-rose-500/15',   text: 'text-rose-400/70' },
  'data-sync':    { bg: 'bg-cyan-500/10 border-cyan-500/15',   text: 'text-cyan-400/70' },
  monitoring:     { bg: 'bg-amber-500/10 border-amber-500/15', text: 'text-amber-400/70' },
  automation:     { bg: 'bg-violet-500/10 border-violet-500/15', text: 'text-violet-400/70' },
  communication:  { bg: 'bg-blue-500/10 border-blue-500/15',   text: 'text-blue-400/70' },
  reporting:      { bg: 'bg-emerald-500/10 border-emerald-500/15', text: 'text-emerald-400/70' },
};

export function parseDesignContext(raw: string | null | undefined): DesignContextData {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as DesignContextData;
    }
  } catch {
    // Legacy plain-text design_context
  }
  return { summary: raw };
}

/** Merge a credential link into a design_context JSON string. */
export function mergeCredentialLink(
  rawDesignContext: string | null | undefined,
  connectorName: string,
  credentialId: string,
): string {
  const data = parseDesignContext(rawDesignContext);
  return JSON.stringify({
    ...data,
    credential_links: { ...data.credential_links, [connectorName]: credentialId },
  });
}

interface UseCasesListProps {
  designContext: string | null | undefined;
  /** Empty state message when no structured use cases */
  emptyMessage?: string;
  /** Sub-message below empty state */
  emptyHint?: string;
}

export function UseCasesList({ designContext, emptyMessage, emptyHint }: UseCasesListProps) {
  const contextData = useMemo(() => parseDesignContext(designContext), [designContext]);
  const useCases = contextData.use_cases ?? [];

  if (useCases.length === 0) {
    return (
      <div className="text-center py-8 space-y-2">
        <ListChecks className="w-5 h-5 text-muted-foreground/40 mx-auto" />
        <p className="text-sm text-muted-foreground/60">
          {emptyMessage ?? (designContext ? 'No structured use cases found.' : 'No use cases generated yet.')}
        </p>
        {emptyHint && (
          <p className="text-sm text-muted-foreground/40">{emptyHint}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <ListChecks className="w-3.5 h-3.5 text-muted-foreground/80" />
        <p className="text-sm text-muted-foreground/80">
          {useCases.length} use case{useCases.length !== 1 ? 's' : ''} identified
        </p>
      </div>

      <div className="space-y-2">
        {useCases.map((uc, i) => {
          const catStyle = uc.category ? CATEGORY_STYLES[uc.category] : null;
          return (
            <div
              key={uc.id || i}
              className="p-3.5 rounded-xl border border-primary/10 bg-secondary/20"
            >
              <div className="flex items-start gap-3">
                <span className="text-sm font-semibold text-muted-foreground/50 mt-0.5 w-5 text-right flex-shrink-0">
                  {i + 1}.
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-foreground/95">{uc.title}</p>
                    {uc.category && catStyle && (
                      <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded border ${catStyle.bg} ${catStyle.text} uppercase tracking-wider`}>
                        {uc.category.replace('-', ' ')}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-foreground/60 mt-1 leading-relaxed">
                    {uc.description}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {contextData.summary && (
        <div className="px-1 mt-2">
          <p className="text-sm text-muted-foreground/60 leading-relaxed">
            {contextData.summary}
          </p>
        </div>
      )}
    </div>
  );
}
