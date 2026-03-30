import { useState, useCallback } from 'react';
import {
  ArrowLeft, Loader2, Globe, FileText, Check, ChevronRight, ChevronDown,
  Zap, Shield, Database, Play, AlertCircle, Copy, ExternalLink,
} from 'lucide-react';
import { useFieldValidation } from '@/features/shared/components/forms/useFieldValidation';
import { SuccessCheck } from '@/features/shared/components/forms/SuccessCheck';
import type { OpenApiParseResult } from '@/lib/bindings/OpenApiParseResult';
import type { GeneratedConnectorResult } from '@/lib/bindings/GeneratedConnectorResult';
import type { OpenApiEndpoint } from '@/lib/bindings/OpenApiEndpoint';
import {
  openapiParseFromUrl,
  openapiParseFromContent,
  openapiGenerateConnector,
} from '@/api/vault/openapiAutopilot';
import { AutopilotPlayground } from './AutopilotPlayground';

type Step = 'input' | 'preview' | 'generated' | 'playground';

interface AutopilotPanelProps {
  onBack: () => void;
  onComplete: () => void;
}

export function AutopilotPanel({ onBack, onComplete }: AutopilotPanelProps) {
  const [step, setStep] = useState<Step>('input');
  const [inputMode, setInputMode] = useState<'url' | 'paste'>('url');
  const [specUrl, setSpecUrl] = useState('');
  const [specContent, setSpecContent] = useState('');
  const [customName, setCustomName] = useState('');
  const [customColor, setCustomColor] = useState('#3B82F6');
  const [isParsing, setIsParsing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<OpenApiParseResult | null>(null);
  const [selectedEndpoints, setSelectedEndpoints] = useState<Set<number>>(new Set());
  const [generatedResult, setGeneratedResult] = useState<GeneratedConnectorResult | null>(null);
  const [expandedTags, setExpandedTags] = useState<Set<string>>(new Set());

  const urlValidation = useFieldValidation({
    validate: (value) => {
      try {
        const u = new URL(value);
        if (!['http:', 'https:'].includes(u.protocol)) return 'URL must use http or https';
        if (!u.hostname) return 'URL must include a hostname';
        return null;
      } catch {
        return 'Enter a valid URL (e.g. https://api.example.com/openapi.json)';
      }
    },
    debounceMs: 300,
    minLength: 8,
  });

  const handleParse = useCallback(async () => {
    setIsParsing(true);
    setError(null);
    try {
      const result = inputMode === 'url'
        ? await openapiParseFromUrl(specUrl.trim())
        : await openapiParseFromContent(specContent.trim());
      setParseResult(result);
      setSelectedEndpoints(new Set(result.endpoints.map((_, i) => i)));
      setCustomName(result.title);
      setStep('preview');
    } catch (err: unknown) {
      const msg = err instanceof Object && 'error' in err ? (err as { error: string }).error : String(err);
      setError(msg);
    } finally {
      setIsParsing(false);
    }
  }, [inputMode, specUrl, specContent]);

  const handleGenerate = useCallback(async () => {
    if (!parseResult) return;
    setIsGenerating(true);
    setError(null);
    try {
      const indices = Array.from(selectedEndpoints);
      const result = await openapiGenerateConnector(
        parseResult,
        indices.length < parseResult.endpoints.length ? indices : undefined,
        customName || undefined,
        customColor,
      );
      setGeneratedResult(result);
      setStep('generated');
    } catch (err: unknown) {
      const msg = err instanceof Object && 'error' in err ? (err as { error: string }).error : String(err);
      setError(msg);
    } finally {
      setIsGenerating(false);
    }
  }, [parseResult, selectedEndpoints, customName, customColor]);

  const toggleEndpoint = (index: number) => {
    setSelectedEndpoints(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleTag = (tag: string) => {
    setExpandedTags(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const selectAllEndpoints = () => {
    if (parseResult) setSelectedEndpoints(new Set(parseResult.endpoints.map((_, i) => i)));
  };

  const deselectAllEndpoints = () => setSelectedEndpoints(new Set());

  if (step === 'playground' && generatedResult && parseResult) {
    return (
      <AutopilotPlayground
        parseResult={parseResult}
        generatedResult={generatedResult}
        onBack={() => setStep('generated')}
      />
    );
  }

  return (
    <div className="animate-fade-slide-in space-y-4" data-testid="vault-autopilot-container">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          data-testid="vault-autopilot-back"
          onClick={step === 'input' ? onBack : () => setStep(step === 'generated' ? 'preview' : 'input')}
          className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground/80 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground">API Autopilot</h3>
          <p className="text-sm text-muted-foreground/60">
            {step === 'input' && 'Paste an OpenAPI spec URL or content to auto-generate a connector'}
            {step === 'preview' && 'Review the parsed API and select which endpoints to include'}
            {step === 'generated' && 'Your connector has been generated successfully'}
          </p>
        </div>
        {/* Step indicators */}
        <div className="flex items-center gap-1.5">
          {(['input', 'preview', 'generated'] as const).map((s, i) => (
            <div
              key={s}
              className={`w-2 h-2 rounded-full transition-colors ${
                s === step ? 'bg-blue-500' :
                (['input', 'preview', 'generated'].indexOf(step) > i) ? 'bg-blue-500/40' : 'bg-muted-foreground/20'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Step 1: Input */}
      {step === 'input' && (
        <div className="space-y-4">
          {/* Mode Toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setInputMode('url')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all ${
                inputMode === 'url'
                  ? 'bg-blue-500/15 border-blue-500/30 text-blue-400'
                  : 'bg-secondary/25 border-primary/15 text-muted-foreground hover:bg-secondary/40'
              }`}
            >
              <Globe className="w-4 h-4" />
              From URL
            </button>
            <button
              onClick={() => setInputMode('paste')}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all ${
                inputMode === 'paste'
                  ? 'bg-blue-500/15 border-blue-500/30 text-blue-400'
                  : 'bg-secondary/25 border-primary/15 text-muted-foreground hover:bg-secondary/40'
              }`}
            >
              <FileText className="w-4 h-4" />
              Paste Content
            </button>
          </div>

          {inputMode === 'url' ? (
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground/80">
                OpenAPI Spec URL
                {urlValidation.validationState === 'validating' && (
                  <Loader2 aria-hidden="true" className="ml-1.5 inline-block w-3.5 h-3.5 animate-spin text-muted-foreground/60 align-text-bottom" />
                )}
                {urlValidation.validationState === 'valid' && (
                  <span className="ml-1.5"><SuccessCheck visible /></span>
                )}
              </label>
              <input
                type="url"
                value={specUrl}
                onChange={(e) => {
                  setSpecUrl(e.target.value);
                  urlValidation.onChange(e.target.value);
                }}
                placeholder="https://api.example.com/openapi.json"
                data-testid="vault-autopilot-url-input"
                className={`w-full px-3 py-2.5 bg-secondary/30 border rounded-lg text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-blue-500/40 ${
                  urlValidation.validationState === 'error' ? 'border-red-500/40' :
                  urlValidation.validationState === 'valid' ? 'border-emerald-500/30' :
                  'border-primary/15'
                }`}
              />
              {urlValidation.error ? (
                <p className="animate-fade-slide-in text-xs text-red-400" role="alert">{urlValidation.error}</p>
              ) : (
                <p className="text-xs text-muted-foreground/40">
                  Supports OpenAPI 3.x and Swagger 2.x specs in JSON or YAML format
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground/80">Paste OpenAPI Spec (JSON or YAML)</label>
              <textarea
                value={specContent}
                onChange={(e) => setSpecContent(e.target.value)}
                placeholder={'{\n  "openapi": "3.0.0",\n  "info": { "title": "My API", ... },\n  "paths": { ... }\n}'}
                rows={12}
                className="w-full px-3 py-2.5 bg-secondary/30 border border-primary/15 rounded-lg text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-blue-500/40 font-mono resize-y"
              />
            </div>
          )}

          <button
            onClick={handleParse}
            disabled={isParsing || (inputMode === 'url' ? !specUrl.trim() : !specContent.trim())}
            data-testid="vault-autopilot-submit"
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/30 text-blue-400 rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isParsing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {isParsing ? 'Parsing Spec...' : 'Parse & Analyze'}
          </button>
        </div>
      )}

      {/* Step 2: Preview */}
      {step === 'preview' && parseResult && (
        <div className="space-y-4" data-testid="vault-autopilot-preview">
          {/* API Summary Card */}
          <div className="p-4 bg-secondary/30 border border-primary/15 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-medium text-foreground">{parseResult.title}</h4>
                <p className="text-xs text-muted-foreground/60">v{parseResult.version} &middot; {parseResult.specFormat === 'openapi3' ? 'OpenAPI 3.x' : 'Swagger 2.x'}</p>
              </div>
              {parseResult.baseUrl && (
                <span className="text-xs text-muted-foreground/50 font-mono">{parseResult.baseUrl}</span>
              )}
            </div>
            {parseResult.description && (
              <p className="text-sm text-muted-foreground/70 leading-relaxed">{parseResult.description}</p>
            )}
            <div className="flex gap-4 text-xs text-muted-foreground/50">
              <span className="flex items-center gap-1"><Zap className="w-3 h-3" /> {parseResult.endpoints.length} endpoints</span>
              <span className="flex items-center gap-1"><Shield className="w-3 h-3" /> {parseResult.authSchemes.length} auth schemes</span>
              <span className="flex items-center gap-1"><Database className="w-3 h-3" /> {parseResult.models.length} models</span>
            </div>
          </div>

          {/* Auth Schemes */}
          {parseResult.authSchemes.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-muted-foreground/60 uppercase tracking-wider">Authentication</h4>
              <div className="flex flex-wrap gap-2">
                {parseResult.authSchemes.map((auth) => (
                  <div key={auth.name} className="px-2.5 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs text-emerald-400">
                    <span className="font-medium">{auth.name}</span>
                    <span className="text-emerald-400/60 ml-1">({auth.schemeType}{auth.scheme ? ` / ${auth.scheme}` : ''})</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Connector Name & Color */}
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground/60">Connector Name</label>
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                className="w-full px-3 py-2 bg-secondary/30 border border-primary/15 rounded-lg text-sm text-foreground focus:outline-none focus:border-blue-500/40"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground/60">Color</label>
              <input
                type="color"
                value={customColor}
                onChange={(e) => setCustomColor(e.target.value)}
                className="w-10 h-[38px] rounded-lg border border-primary/15 cursor-pointer bg-transparent"
              />
            </div>
          </div>

          {/* Endpoint Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-medium text-muted-foreground/60 uppercase tracking-wider">
                Endpoints ({selectedEndpoints.size}/{parseResult.endpoints.length} selected)
              </h4>
              <div className="flex gap-2 text-xs">
                <button onClick={selectAllEndpoints} className="text-blue-400 hover:text-blue-300">Select all</button>
                <button onClick={deselectAllEndpoints} className="text-muted-foreground/50 hover:text-muted-foreground">None</button>
              </div>
            </div>

            <div className="max-h-80 overflow-y-auto space-y-1 rounded-lg border border-primary/10 p-2 bg-secondary/15">
              <EndpointList
                endpoints={parseResult.endpoints}
                selectedEndpoints={selectedEndpoints}
                expandedTags={expandedTags}
                onToggleEndpoint={toggleEndpoint}
                onToggleTag={toggleTag}
              />
            </div>
          </div>

          {/* Generate Button */}
          <div className="flex gap-3">
            <button
              onClick={() => setStep('input')}
              className="px-4 py-2.5 border border-primary/15 text-muted-foreground hover:text-foreground rounded-lg text-sm transition-colors"
            >
              Back
            </button>
            <button
              onClick={handleGenerate}
              disabled={isGenerating || selectedEndpoints.size === 0}
              data-testid="vault-autopilot-confirm"
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/30 text-blue-400 rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              {isGenerating ? 'Generating...' : `Generate Connector (${selectedEndpoints.size} tools)`}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Generated Result */}
      {step === 'generated' && generatedResult && (
        <div className="space-y-4">
          <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
            <div className="flex items-center gap-2 mb-2">
              <Check className="w-5 h-5 text-emerald-400" />
              <h4 className="text-sm font-medium text-emerald-400">Connector Generated Successfully</h4>
            </div>
            <p className="text-sm text-muted-foreground/70">
              <strong>{generatedResult.connectorLabel}</strong> is now available in your connector catalog
              with {generatedResult.tools.length} tool definitions.
            </p>
          </div>

          {/* Generated Tools */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground/60 uppercase tracking-wider">
              Generated Tools ({generatedResult.tools.length})
            </h4>
            <div className="max-h-60 overflow-y-auto space-y-1 rounded-lg border border-primary/10 p-2 bg-secondary/15">
              {generatedResult.tools.map((tool) => (
                <div key={tool.toolName} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-secondary/30">
                  <MethodBadge method={tool.method} />
                  <span className="text-xs font-mono text-muted-foreground/60">{tool.path}</span>
                  <span className="text-xs text-foreground/80 ml-auto truncate max-w-[200px]">{tool.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Credential Fields */}
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground/60 uppercase tracking-wider">
              Credential Fields
            </h4>
            <div className="flex flex-wrap gap-2">
              {generatedResult.credentialFields.map((field: unknown, i) => {
                const f = field as { key: string; label: string; type: string };
                return (
                  <span key={i} className="px-2 py-1 bg-secondary/30 border border-primary/10 rounded text-xs text-muted-foreground/70">
                    {f.label} <span className="text-muted-foreground/40">({f.type})</span>
                  </span>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={() => setStep('playground')}
              className="flex items-center gap-2 px-4 py-2.5 bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/30 text-violet-400 rounded-lg text-sm font-medium transition-all"
            >
              <Play className="w-4 h-4" />
              Open Playground
            </button>
            <button
              onClick={() => {
                navigator.clipboard.writeText(generatedResult.connectorId);
              }}
              className="flex items-center gap-2 px-4 py-2.5 border border-primary/15 text-muted-foreground hover:text-foreground rounded-lg text-sm transition-colors"
            >
              <Copy className="w-4 h-4" />
              Copy Connector ID
            </button>
            <button
              onClick={onComplete}
              className="flex items-center gap-2 px-4 py-2.5 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 rounded-lg text-sm font-medium transition-all ml-auto"
            >
              <ExternalLink className="w-4 h-4" />
              Go to Catalog
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// -- Sub-components --------------------------------------------------------

function MethodBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    GET: 'text-emerald-400 bg-emerald-500/15',
    POST: 'text-blue-400 bg-blue-500/15',
    PUT: 'text-amber-400 bg-amber-500/15',
    PATCH: 'text-orange-400 bg-orange-500/15',
    DELETE: 'text-red-400 bg-red-500/15',
    HEAD: 'text-purple-400 bg-purple-500/15',
    OPTIONS: 'text-gray-400 bg-gray-500/15',
  };
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider ${colors[method] ?? 'text-gray-400 bg-gray-500/15'}`}>
      {method}
    </span>
  );
}

function EndpointList({
  endpoints,
  selectedEndpoints,
  expandedTags,
  onToggleEndpoint,
  onToggleTag,
}: {
  endpoints: OpenApiEndpoint[];
  selectedEndpoints: Set<number>;
  expandedTags: Set<string>;
  onToggleEndpoint: (i: number) => void;
  onToggleTag: (tag: string) => void;
}) {
  // Group by first tag
  const grouped = new Map<string, { endpoint: OpenApiEndpoint; index: number }[]>();
  endpoints.forEach((ep, index) => {
    const tag = ep.tags[0] ?? 'Other';
    if (!grouped.has(tag)) grouped.set(tag, []);
    grouped.get(tag)!.push({ endpoint: ep, index });
  });

  return (
    <>
      {Array.from(grouped.entries()).map(([tag, items]) => {
        const isExpanded = expandedTags.has(tag);
        const selectedCount = items.filter(i => selectedEndpoints.has(i.index)).length;
        return (
          <div key={tag}>
            <button
              onClick={() => onToggleTag(tag)}
              className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-muted-foreground/70 hover:text-foreground rounded-md hover:bg-secondary/30"
            >
              {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <span className="font-medium">{tag}</span>
              <span className="text-muted-foreground/40 ml-auto">{selectedCount}/{items.length}</span>
            </button>
            {isExpanded && items.map(({ endpoint, index }) => (
              <label
                key={index}
                className="flex items-center gap-2 px-2 py-1 ml-4 rounded-md hover:bg-secondary/20 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedEndpoints.has(index)}
                  onChange={() => onToggleEndpoint(index)}
                  className="rounded border-primary/20"
                />
                <MethodBadge method={endpoint.method} />
                <span className="text-xs font-mono text-muted-foreground/60 truncate">{endpoint.path}</span>
                {endpoint.summary && (
                  <span className="text-xs text-muted-foreground/40 truncate ml-auto max-w-[180px]">{endpoint.summary}</span>
                )}
              </label>
            ))}
          </div>
        );
      })}
    </>
  );
}
