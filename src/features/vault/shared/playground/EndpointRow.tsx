import { ChevronDown, ChevronRight, Play, CheckCircle2, XCircle, MinusCircle, Clock } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { ApiEndpoint } from '@/api/system/apiProxy';
import type { EndpointTestResult } from './useApiTestRunner';
import { useTranslation } from '@/i18n/useTranslation';
import { prettyJson } from './prettyJson';
import { Button } from '@/features/shared/components/buttons';

// -- Method badge colors ------------------------------------------

const METHOD_STYLES: Record<string, string> = {
  GET: 'bg-status-success/15 text-status-success border-status-success/25',
  POST: 'bg-status-info/15 text-status-info border-status-info/25',
  PUT: 'bg-status-warning/15 text-status-warning border-status-warning/25',
  PATCH: 'bg-role-agent/15 text-role-agent border-role-agent/25',
  DELETE: 'bg-status-error/15 text-status-error border-status-error/25',
};

const DEFAULT_METHOD_STYLE = 'bg-surface-1 text-foreground border-hair';

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
    <div className="border border-primary/8 rounded-card overflow-hidden transition-colors hover:border-hair">
      {/* Compact row: the expander is a real button (it was a clickable
          div with role="row", unreachable by keyboard and silent about its
          state), and Try sits beside it rather than inside it. */}
      <div className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-surface-1 transition-colors">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isExpanded}
          className="flex-1 min-w-0 flex items-center gap-2.5 text-left"
        >
          {isExpanded ? (
            <ChevronDown className="w-3 h-3 text-foreground shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 text-foreground shrink-0" />
          )}

          <span
            className={`px-2 py-0.5 rounded-interactive typo-eyebrow border ${methodStyle} shrink-0 min-w-[52px] text-center`}
          >
            {endpoint.method.toUpperCase()}
          </span>

          <span className="typo-code text-foreground truncate flex-1">
            {endpoint.path}
          </span>

          {endpoint.summary && (
            <span className="typo-body text-foreground truncate max-w-[240px] hidden sm:inline">
              {endpoint.summary}
            </span>
          )}
        </button>

        {/* Test result badge */}
        {testResult && <TestBadge result={testResult} skipLabel={t.common.skip} />}

        <Button
          variant="accent"
          tone="success"
          size="xs"
          icon={<Play className="w-2.5 h-2.5" />}
          onClick={onTry}
          className="shrink-0"
        >
          {t.vault.playground.try_button}
        </Button>
      </div>

      {/* Expanded detail */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-1 border-t border-hair bg-secondary/10 space-y-2">
          {endpoint.description && (
            <p className="typo-body text-foreground">
              {endpoint.description}
            </p>
          )}

          {endpoint.tags.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {endpoint.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-1.5 py-0.5 rounded-interactive typo-body text-foreground bg-surface-2 border border-primary/8"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {endpoint.parameters.length > 0 && (
            <div className="space-y-1">
              <span className="typo-eyebrow text-role-highlight/70">
                {t.vault.playground.parameters}
              </span>
              <div className="space-y-0.5">
                {endpoint.parameters.map((p) => (
                  <div key={`${p.location}-${p.name}`} className="flex items-center gap-2 typo-body">
                    <span className="font-mono text-foreground">{p.name}</span>
                    <span className="typo-body text-foreground">
                      {p.location}{p.required ? ` · ${t.common.required}` : ''}
                    </span>
                    {p.schema_type && (
                      <span className="typo-body text-role-agent/60">{p.schema_type}</span>
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
              <span className="typo-eyebrow text-role-highlight/70">
                {t.vault.shared.request_body}
              </span>
              <div className="typo-body text-foreground">
                {endpoint.request_body.content_type}
                {endpoint.request_body.required && ` · ${t.common.required}`}
              </div>
              {endpoint.request_body.schema_json && (
                <pre className="typo-code text-foreground bg-surface-1 rounded-interactive p-2 overflow-x-auto max-h-[120px]">
                  {prettyJson(endpoint.request_body.schema_json)}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// -- Test result badge ---------------------------------------------

function TestBadge({ result, skipLabel }: { result: EndpointTestResult; skipLabel: string }) {
  switch (result.verdict) {
    case 'running':
      return (
        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-interactive typo-body text-status-info/80 shrink-0">
          <LoadingSpinner size="xs" />
        </span>
      );
    case 'passed':
      return (
        <span className="flex items-center gap-1 typo-body text-status-success shrink-0">
          <CheckCircle2 className="w-3 h-3" />
          {result.httpStatus}
          {result.durationMs != null && (
            <span className="flex items-center gap-0.5 text-status-success/50">
              <Clock className="w-2.5 h-2.5" />
              {result.durationMs}ms
            </span>
          )}
        </span>
      );
    case 'failed':
      return (
        <span className="flex items-center gap-1 typo-body text-status-error shrink-0">
          <XCircle className="w-3 h-3" />
          {result.httpStatus ?? 'ERR'}
          {result.durationMs != null && (
            <span className="flex items-center gap-0.5 text-status-error/50">
              <Clock className="w-2.5 h-2.5" />
              {result.durationMs}ms
            </span>
          )}
        </span>
      );
    case 'skipped':
      return (
        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-interactive typo-body text-foreground shrink-0">
          <MinusCircle className="w-3 h-3" />
          {skipLabel}
        </span>
      );
    default:
      return null;
  }
}
