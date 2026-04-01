import { useState, useCallback } from 'react';
import { useFieldValidation } from '@/features/shared/components/forms/useFieldValidation';
import type { OpenApiParseResult } from '@/lib/bindings/OpenApiParseResult';
import type { GeneratedConnectorResult } from '@/lib/bindings/GeneratedConnectorResult';
import {
  openapiParseFromUrl,
  openapiParseFromContent,
  openapiGenerateConnector,
} from '@/api/vault/openapiAutopilot';
import { AutopilotPlayground } from './AutopilotPlayground';
import { AutopilotHeader } from './AutopilotHeader';
import { AutopilotInputStep } from './AutopilotInputStep';
import { AutopilotPreviewStep } from './AutopilotPreviewStep';
import { AutopilotGeneratedStep } from './AutopilotGeneratedStep';

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
      <AutopilotHeader
        step={step as 'input' | 'preview' | 'generated'}
        error={error}
        onBack={step === 'input' ? onBack : () => setStep(step === 'generated' ? 'preview' : 'input')}
      />

      {step === 'input' && (
        <AutopilotInputStep
          inputMode={inputMode}
          setInputMode={setInputMode}
          specUrl={specUrl}
          setSpecUrl={setSpecUrl}
          specContent={specContent}
          setSpecContent={setSpecContent}
          isParsing={isParsing}
          onParse={handleParse}
          urlValidation={urlValidation}
        />
      )}

      {step === 'preview' && parseResult && (
        <AutopilotPreviewStep
          parseResult={parseResult}
          customName={customName}
          setCustomName={setCustomName}
          customColor={customColor}
          setCustomColor={setCustomColor}
          selectedEndpoints={selectedEndpoints}
          expandedTags={expandedTags}
          isGenerating={isGenerating}
          onToggleEndpoint={toggleEndpoint}
          onToggleTag={toggleTag}
          onSelectAll={selectAllEndpoints}
          onDeselectAll={deselectAllEndpoints}
          onGenerate={handleGenerate}
          onBack={() => setStep('input')}
        />
      )}

      {step === 'generated' && generatedResult && (
        <AutopilotGeneratedStep
          generatedResult={generatedResult}
          onPlayground={() => setStep('playground')}
          onComplete={onComplete}
        />
      )}
    </div>
  );
}
