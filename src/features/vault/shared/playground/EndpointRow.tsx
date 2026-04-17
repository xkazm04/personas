import { ChevronDown, ChevronRight, Play, CheckCircle2, XCircle, MinusCircle, Clock } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { ApiEndpoint } from '@/api/system/apiProxy';
import type { EndpointTestResult } from './useApiTestRunner';
import { useTranslation } from '@/i18n/useTranslation';

// -- Method badge colors ------------------------------------------

const METHOD_STYLES: Record<string, string> = {
  GET: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  POST: 'bg-blue-500/15 text-blue-400 border-blue-500/25',
  PUT: 'bg-amber-500/15 text-amber-400 border-amber-500/25',
  PATCH: 'bg-violet-500/15 text-violet-400 border-violet-500/25',
  DELETE: 'bg-red-500/15 text-red-400 border-red-500/25',
};

const DEFAULT_METHOD_STYLE = 'bg-secondary/30 text-foreground border-primary/10';

// -- Component ----------------------------------------------------

interface EndpointRowProps {
  endpoint: ApiEndpoint;
  isExpanded: boolean;
  onToggle: () => void;
  onTry: () => void;
  testResult?: EndpointTestResult;
}

export function EndpointRow({ endpoint, isExpanded, onToggle, onTry, testResult }: EndpointRowProps) {
  const { t } = useTranslation();
  const methodStyle = METHOD_STYLES[endpoint.method.toUpperCase()] || DEFAULT_METHOD_STYLE;

  return (
    <div className="border border-primary/8 rounded-card overflow-hidden transition-colors hover:border-primary/15">
      {/* Compact row */}
      <div
        role="row"
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-secondary/20 transition-colors cursor-pointer"
        onClick={onToggle}
      >
        {isExpanded ? (
          <ChevronDown className="w-3 h-3 text-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-foreground shrink-0" />
        )}

        <span
          className={`px-2 py-0.5 rounded typo-heading font-bold uppercase border ${methodStyle} shrink-0 min-w-[52px] text-center`}
        >
          {endpoint.method.toUpperCase()}
        </span>

        <span className="font-mono typo-code text-foreground truncate flex-1">
          {endpoint.path}
        </span>

        {endpoint.summary && (
          <span className="typo-body text-foreground truncate max-w-[240px] hidden sm:inline">
            {endpoint.summary}
          </span>
        )}

        {/* Test result badge */}
        {testResult && <TestBadge result={testResult} />}

        <button
          onClick={(e) => { e.stopPropagation(); onTry(); }}
          className="flex items-center gap-1 px-2 py-1 rounded typo-body font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors shrink-0"
        >
          <Play className="w-2.5 h-2.5" />
          Try
        </button>
      </div>

      {/* Expanded detail */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-1 border-t border-primary/5 bg-secondary/10 space-y-2">
          {endpoint.description && (
            <p className="typo-body text-foreground leading-relaxed">
              {endpoint.description}
            </p>
          )}

          {endpoint.tags.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {endpoint.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-1.5 py-0.5 rounded typo-body text-foreground bg-secondary/40 border border-primary/8"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {endpoint.parameters.length > 0 && (
            <div className="space-y-1">
              <span className="typo-heading uppercase tracking-wider text-cyan-400/70 font-semibold">
                Parameters
              </span>
              <div className="space-y-0.5">
                {endpoint.parameters.map((p) => (
                  <div key={`${p.location}-${p.name}`} className="flex items-center gap-2 typo-body">
                    <span className="font-mono text-foreground">{p.name}</span>
                    <span className="typo-body text-foreground">
                      {p.location}{p.required ? ' · required' : ''}
                    </span>
                    {p.schema_type && (
                      <span className="typo-body text-violet-400/60">{p.schema_type}</span>
                    )}
                    {p.description && (
                      <span className="typo-body text-foreground truncate">
                        -- {p.description}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {endpoint.request_body && (
            <div className="space-y-1">
              <span className="typo-heading uppercase tracking-wider text-cyan-400/70 font-semibold">
                {t.vault.shared.request_body}
              </span>
              <div className="typo-body text-foreground">
                {endpoint.request_body.content_type}
                {endpoint.request_body.required && ' · required'}
              </div>
              {endpoint.request_body.schema_json && (
                <pre className="typo-code text-foreground font-mono bg-secondary/20 rounded p-2 overflow-x-auto max-h-[120px]">
                  {formatSchema(endpoint.request_body.schema_json)}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatSchema(schemaJson: string): string {
  try {
    return JSON.stringify(JSON.parse(schemaJson), null, 2);
  } catch {
    // intentional: non-critical -- JSON parse fallback
    return schemaJson;
  }
}

// -- Test result badge ---------------------------------------------

function TestBadge({ result }: { result: EndpointTestResult }) {
  switch (result.verdict) {
    case 'running':
      return (
        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded typo-body text-blue-400/80 shrink-0">
          <LoadingSpinner size="xs" />
        </span>
      );
    case 'passed':
      return (
        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded typo-body bg-emerald-500/10 text-emerald-400 border border-emerald-500/15 shrink-0">
          <CheckCircle2 className="w-3 h-3" />
          {result.httpStatus}
          {result.durationMs != null && (
            <span className="flex items-center gap-0.5 text-emerald-400/50">
              <Clock className="w-2.5 h-2.5" />
              {result.durationMs}ms
            </span>
          )}
        </span>
      );
    case 'failed':
      return (
        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded typo-body bg-red-500/10 text-red-400 border border-red-500/15 shrink-0">
          <XCircle className="w-3 h-3" />
          {result.httpStatus ?? 'ERR'}
          {result.durationMs != null && (
            <span className="flex items-center gap-0.5 text-red-400/50">
              <Clock className="w-2.5 h-2.5" />
              {result.durationMs}ms
            </span>
          )}
        </span>
      );
    case 'skipped':
      return (
        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded typo-body text-foreground shrink-0">
          <MinusCircle className="w-3 h-3" />
          skip
        </span>
      );
    default:
      return null;
  }
}
