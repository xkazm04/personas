import { Loader2, ChevronRight, ChevronDown, Zap, Shield, Database } from 'lucide-react';
import type { OpenApiParseResult } from '@/lib/bindings/OpenApiParseResult';
import type { OpenApiEndpoint } from '@/lib/bindings/OpenApiEndpoint';
import { MethodBadge } from './AutopilotShared';
import { useTranslation } from '@/i18n/useTranslation';

interface AutopilotPreviewStepProps {
  parseResult: OpenApiParseResult;
  customName: string;
  setCustomName: (name: string) => void;
  customColor: string;
  setCustomColor: (color: string) => void;
  selectedEndpoints: Set<number>;
  expandedTags: Set<string>;
  isGenerating: boolean;
  onToggleEndpoint: (index: number) => void;
  onToggleTag: (tag: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onGenerate: () => void;
  onBack: () => void;
}

export function AutopilotPreviewStep({
  parseResult,
  customName,
  setCustomName,
  customColor,
  setCustomColor,
  selectedEndpoints,
  expandedTags,
  isGenerating,
  onToggleEndpoint,
  onToggleTag,
  onSelectAll,
  onDeselectAll,
  onGenerate,
  onBack,
}: AutopilotPreviewStepProps) {
  const { t, tx } = useTranslation();
  return (
    <div className="space-y-4" data-testid="vault-autopilot-preview">
      {/* API Summary Card */}
      <div className="p-4 bg-secondary/30 border border-primary/15 rounded-modal space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="typo-body font-medium text-foreground">{parseResult.title}</h4>
            <p className="typo-caption text-foreground">v{parseResult.version} &middot; {parseResult.specFormat === 'openapi3' ? 'OpenAPI 3.x' : 'Swagger 2.x'}</p>
          </div>
          {parseResult.baseUrl && (
            <span className="typo-code text-foreground font-mono">{parseResult.baseUrl}</span>
          )}
        </div>
        {parseResult.description && (
          <p className="typo-body text-foreground leading-relaxed">{parseResult.description}</p>
        )}
        <div className="flex gap-4 typo-caption text-foreground">
          <span className="flex items-center gap-1"><Zap className="w-3 h-3" /> {parseResult.endpoints.length} endpoints</span>
          <span className="flex items-center gap-1"><Shield className="w-3 h-3" /> {parseResult.authSchemes.length} {t.vault.autopilot.auth_schemes}</span>
          <span className="flex items-center gap-1"><Database className="w-3 h-3" /> {parseResult.models.length} models</span>
        </div>
      </div>

      {/* Auth Schemes */}
      {parseResult.authSchemes.length > 0 && (
        <div className="space-y-2">
          <h4 className="typo-label font-medium text-foreground uppercase tracking-wider">{t.vault.autopilot.authentication}</h4>
          <div className="flex flex-wrap gap-2">
            {parseResult.authSchemes.map((auth) => (
              <div key={auth.name} className="px-2.5 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-card typo-caption text-emerald-400">
                <span className="font-medium">{auth.name}</span>
                <span className="text-emerald-400/60 ml-1">({auth.schemeType}{auth.scheme ? ` / ${auth.scheme}` : ''})</span>
              </div>))}
          </div>
        </div>)}
      {/* Connector Name & Color */}
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <div className="space-y-1">
          <label className="typo-caption text-foreground">{t.vault.autopilot.connector_name}</label>
          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            className="w-full px-3 py-2 bg-secondary/30 border border-primary/15 rounded-card typo-body text-foreground focus:outline-none focus:border-blue-500/40"
          />
        </div>
        <div className="space-y-1">
          <label className="typo-caption text-foreground">{t.vault.autopilot.color}</label>
          <input
            type="color"
            value={customColor}
            onChange={(e) => setCustomColor(e.target.value)}
            className="w-10 h-[38px] rounded-card border border-primary/15 cursor-pointer bg-transparent"
          />
        </div>
      </div>

      {/* Endpoint Selection */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="typo-label font-medium text-foreground uppercase tracking-wider">
            {tx(t.vault.autopilot.endpoints_selected, { selected: selectedEndpoints.size, total: parseResult.endpoints.length })}
          </h4>
          <div className="flex gap-2 typo-caption">
            <button onClick={onSelectAll} className="text-blue-400 hover:text-blue-300">{t.vault.import.select_all}</button>
            <button onClick={onDeselectAll} className="text-foreground hover:text-muted-foreground">{t.vault.import.deselect_all}</button>
          </div>
        </div>

        <div className="max-h-80 overflow-y-auto space-y-1 rounded-card border border-primary/10 p-2 bg-secondary/15">
          <EndpointList
            endpoints={parseResult.endpoints}
            selectedEndpoints={selectedEndpoints}
            expandedTags={expandedTags}
            onToggleEndpoint={onToggleEndpoint}
            onToggleTag={onToggleTag}
          />
        </div>
      </div>

      {/* Generate Button */}
      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="px-4 py-2.5 border border-primary/15 text-foreground hover:text-foreground rounded-card typo-body transition-colors"
        >
          {t.common.back}
        </button>
        <button
          onClick={onGenerate}
          disabled={isGenerating || selectedEndpoints.size === 0}
          data-testid="vault-autopilot-confirm"
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/30 text-blue-400 rounded-card typo-body font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
          {isGenerating ? t.vault.autopilot.generating : tx(t.vault.autopilot.generate_connector, { count: selectedEndpoints.size })}
        </button>
      </div>
    </div>
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
              className="flex items-center gap-2 w-full px-2 py-1.5 typo-caption text-foreground hover:text-foreground rounded-input hover:bg-secondary/30"
            >
              {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <span className="font-medium">{tag}</span>
              <span className="text-foreground ml-auto">{selectedCount}/{items.length}</span>
            </button>
            {isExpanded && items.map(({ endpoint, index }) => (
              <label
                key={index}
                className="flex items-center gap-2 px-2 py-1 ml-4 rounded-input hover:bg-secondary/20 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedEndpoints.has(index)}
                  onChange={() => onToggleEndpoint(index)}
                  className="rounded border-primary/20"
                />
                <MethodBadge method={endpoint.method} />
                <span className="typo-code font-mono text-foreground truncate">{endpoint.path}</span>
                {endpoint.summary && (
                  <span className="typo-caption text-foreground truncate ml-auto max-w-[180px]">{endpoint.summary}</span>
                )}
              </label>
            ))}
          </div>
        );
      })}
    </>
  );
}
