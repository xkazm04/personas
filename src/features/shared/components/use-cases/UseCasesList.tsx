import { useMemo } from 'react';
import { ListChecks } from 'lucide-react';
import { AnimatedList } from '@/features/shared/components/display/AnimatedList';
import type {
  DesignContextData,
  DesignFilesSection,
  DesignUseCase,
} from '@/lib/types/frontendTypes';

// -- Re-exports for backward compatibility ---------------------------
// These types are now canonically defined in frontendTypes.ts.
// Consumers that imported them from here continue to work.
export type { DesignContextData } from '@/lib/types/frontendTypes';
export type { DesignUseCase as UseCaseItem } from '@/lib/types/frontendTypes';
export type { UseCaseEventSubscription } from '@/lib/types/frontendTypes';
export type { UseCaseInputField } from '@/lib/types/frontendTypes';
export type { UseCaseTimeFilter } from '@/lib/types/frontendTypes';
export type { UseCaseSuggestedTrigger } from '@/lib/types/frontendTypes';

// -- Parser ----------------------------------------------------------

// LRU(1) cache: avoids re-parsing the same design_context string across
// multiple hooks/components in the same render cycle.
let _cachedRaw: string | null | undefined;
let _cachedResult: DesignContextData = {};

/**
 * Parse a raw `design_context` JSON string into the typed envelope.
 * Handles both the new structured format (with camelCase keys) and
 * the legacy flat format (with snake_case keys like `use_cases`, `credential_links`).
 *
 * Results are cached (LRU-1) so repeated calls with the same string
 * (e.g. from useConnectorStatuses, subscriptionLifecycle, etc.) skip parsing.
 */
export function parseDesignContext(raw: string | null | undefined): DesignContextData {
  if (raw === _cachedRaw) return _cachedResult;

  const store = (r: DesignContextData): DesignContextData => {
    _cachedRaw = raw;
    _cachedResult = r;
    return r;
  };

  if (!raw || !raw.trim()) return store({});
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return store({ summary: raw });
    }

    // New format: check for camelCase envelope keys
    if ('designFiles' in parsed || 'credentialLinks' in parsed || 'useCases' in parsed) {
      const data = parsed as unknown as DesignContextData;
      // Normalize useCases: convert string[] to DesignUseCase[] if needed
      if (Array.isArray(data.useCases) && data.useCases.length > 0 && typeof data.useCases[0] === 'string') {
        data.useCases = (data.useCases as unknown as string[]).map((s, i) => ({
          id: `uc-${i}`,
          title: s.length > 80 ? s.slice(0, 80) + '...' : s,
          description: s,
          category: 'general',
          execution_mode: 'mock' as const,
        }));
      }
      return store(data);
    }

    // Legacy format: snake_case top-level keys -> migrate to camelCase envelope
    const result: DesignContextData = {};

    // Legacy: top-level "files"/"references" -> designFiles
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

    return store(result);
  } catch {
    // intentional: non-critical -- JSON parse fallback (treat raw text as summary)
    return store({ summary: raw });
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

// -- Component -------------------------------------------------------

import { STATUS_PALETTE_EXTENDED } from '@/lib/design/statusTokens';

const CATEGORY_STYLES: Record<string, { bg: string; text: string }> = {
  notification:   { bg: `${STATUS_PALETTE_EXTENDED.critical.bg} ${STATUS_PALETTE_EXTENDED.critical.border}`, text: `${STATUS_PALETTE_EXTENDED.critical.text}/70` },
  'data-sync':    { bg: `${STATUS_PALETTE_EXTENDED.rotation.bg} ${STATUS_PALETTE_EXTENDED.rotation.border}`, text: `${STATUS_PALETTE_EXTENDED.rotation.text}/70` },
  monitoring:     { bg: `${STATUS_PALETTE_EXTENDED.warning.bg} ${STATUS_PALETTE_EXTENDED.warning.border}`,   text: `${STATUS_PALETTE_EXTENDED.warning.text}/70` },
  automation:     { bg: `${STATUS_PALETTE_EXTENDED.ai.bg} ${STATUS_PALETTE_EXTENDED.ai.border}`,             text: `${STATUS_PALETTE_EXTENDED.ai.text}/70` },
  communication:  { bg: `${STATUS_PALETTE_EXTENDED.info.bg} ${STATUS_PALETTE_EXTENDED.info.border}`,         text: `${STATUS_PALETTE_EXTENDED.info.text}/70` },
  reporting:      { bg: `${STATUS_PALETTE_EXTENDED.success.bg} ${STATUS_PALETTE_EXTENDED.success.border}`,   text: `${STATUS_PALETTE_EXTENDED.success.text}/70` },
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
        <ListChecks className="w-5 h-5 text-foreground mx-auto" />
        <p className="typo-body text-foreground">
          {emptyMessage ?? (designContext ? 'No structured use cases found.' : 'No use cases generated yet.')}
        </p>
        {emptyHint && (
          <p className="typo-body text-foreground">{emptyHint}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <ListChecks className="w-3.5 h-3.5 text-foreground" />
        <p className="typo-body text-foreground">
          {useCases.length} use case{useCases.length !== 1 ? 's' : ''} identified
        </p>
      </div>

      <AnimatedList
        className="space-y-2"
        keys={useCases.map((uc, i) => uc.id || String(i))}
      >
        {useCases.map((uc, i) => {
          const catStyle = uc.category ? CATEGORY_STYLES[uc.category] : null;
          return (
            <div
              key={uc.id || i}
              className="p-3.5 rounded-xl border border-primary/10 bg-secondary/20"
            >
              <div className="flex items-start gap-3">
                <span className="typo-heading text-foreground mt-0.5 w-5 text-right flex-shrink-0">
                  {i + 1}.
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="typo-heading text-foreground/95">{uc.title}</p>
                    {uc.category && catStyle && (
                      <span className={`px-1.5 py-0.5 typo-label rounded border ${catStyle.bg} ${catStyle.text}`}>
                        {uc.category.replace('-', ' ')}
                      </span>
                    )}
                  </div>
                  <p className="typo-body text-foreground mt-1 leading-relaxed">
                    {uc.description}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </AnimatedList>

      {contextData.summary && (
        <div className="px-1 mt-2">
          <p className="typo-body text-foreground leading-relaxed">
            {contextData.summary}
          </p>
        </div>
      )}
    </div>
  );
}
