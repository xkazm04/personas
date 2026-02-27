import { useMemo } from 'react';
import { ListChecks } from 'lucide-react';
import type {
  DesignContextData,
  DesignFilesSection,
  DesignUseCase,
} from '@/lib/types/frontendTypes';

// ── Re-exports for backward compatibility ───────────────────────────
// These types are now canonically defined in frontendTypes.ts.
// Consumers that imported them from here continue to work.
export type { DesignContextData } from '@/lib/types/frontendTypes';
export type { DesignUseCase as UseCaseItem } from '@/lib/types/frontendTypes';
export type { UseCaseEventSubscription } from '@/lib/types/frontendTypes';
export type { UseCaseInputField } from '@/lib/types/frontendTypes';
export type { UseCaseTimeFilter } from '@/lib/types/frontendTypes';
export type { UseCaseSuggestedTrigger } from '@/lib/types/frontendTypes';

// ── Parser ──────────────────────────────────────────────────────────

/**
 * Parse a raw `design_context` JSON string into the typed envelope.
 * Handles both the new structured format (with camelCase keys) and
 * the legacy flat format (with snake_case keys like `use_cases`, `credential_links`).
 */
export function parseDesignContext(raw: string | null | undefined): DesignContextData {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { summary: raw };
    }

    // New format: check for camelCase envelope keys
    if ('designFiles' in parsed || 'credentialLinks' in parsed || 'useCases' in parsed) {
      return parsed as unknown as DesignContextData;
    }

    // Legacy format: snake_case top-level keys → migrate to camelCase envelope
    const result: DesignContextData = {};

    // Legacy: top-level "files"/"references" → designFiles
    if ('files' in parsed || 'references' in parsed) {
      result.designFiles = {
        files: (parsed.files as DesignFilesSection['files']) ?? [],
        references: (parsed.references as string[]) ?? [],
      };
    }

    // Legacy: top-level "credential_links"
    if ('credential_links' in parsed && parsed.credential_links && typeof parsed.credential_links === 'object') {
      result.credentialLinks = parsed.credential_links as Record<string, string>;
    }

    // Legacy: top-level "use_cases"
    if ('use_cases' in parsed && Array.isArray(parsed.use_cases)) {
      result.useCases = parsed.use_cases as DesignUseCase[];
    }

    // Legacy: top-level "summary"
    if ('summary' in parsed && typeof parsed.summary === 'string' && parsed.summary) {
      result.summary = parsed.summary;
    }

    return result;
  } catch {
    // Completely unparseable — treat raw text as summary
    return { summary: raw };
  }
}

/**
 * Serialize a `DesignContextData` envelope to a JSON string for DB storage.
 */
export function serializeDesignContext(data: DesignContextData): string {
  return JSON.stringify(data);
}

/** Merge a credential link into a design_context JSON string. */
export function mergeCredentialLink(
  rawDesignContext: string | null | undefined,
  connectorName: string,
  credentialId: string,
): string {
  const data = parseDesignContext(rawDesignContext);
  return serializeDesignContext({
    ...data,
    credentialLinks: { ...data.credentialLinks, [connectorName]: credentialId },
  });
}

// ── Component ───────────────────────────────────────────────────────

const CATEGORY_STYLES: Record<string, { bg: string; text: string }> = {
  notification:   { bg: 'bg-rose-500/10 border-rose-500/15',   text: 'text-rose-400/70' },
  'data-sync':    { bg: 'bg-cyan-500/10 border-cyan-500/15',   text: 'text-cyan-400/70' },
  monitoring:     { bg: 'bg-amber-500/10 border-amber-500/15', text: 'text-amber-400/70' },
  automation:     { bg: 'bg-violet-500/10 border-violet-500/15', text: 'text-violet-400/70' },
  communication:  { bg: 'bg-blue-500/10 border-blue-500/15',   text: 'text-blue-400/70' },
  reporting:      { bg: 'bg-emerald-500/10 border-emerald-500/15', text: 'text-emerald-400/70' },
};

interface UseCasesListProps {
  designContext: string | null | undefined;
  /** Empty state message when no structured use cases */
  emptyMessage?: string;
  /** Sub-message below empty state */
  emptyHint?: string;
}

export function UseCasesList({ designContext, emptyMessage, emptyHint }: UseCasesListProps) {
  const contextData = useMemo(() => parseDesignContext(designContext), [designContext]);
  const useCases = contextData.useCases ?? [];

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
