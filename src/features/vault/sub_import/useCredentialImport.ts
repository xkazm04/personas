import { useState, useCallback } from 'react';
import {
  parseImportInput,
  buildMappings,
  buildDesignResultFromImport,
  groupByService,
  type ImportSourceId,
  type ImportParseResult,
  type SecretServiceMapping,
  type SyncConfig,
  type ImportPhase,
} from './importTypes';
import type { CredentialDesignResult } from '@/hooks/design/useCredentialDesign';

export interface CredentialImportState {
  phase: ImportPhase;
  sourceId: ImportSourceId | null;
  rawInput: string;
  parseResult: ImportParseResult | null;
  mappings: SecretServiceMapping[];
  selectedKeys: Set<string>;
  syncConfig: SyncConfig | null;
  error: string | null;
}

export interface CredentialImportActions {
  selectSource: (id: ImportSourceId) => void;
  setRawInput: (input: string) => void;
  parse: () => void;
  toggleKey: (key: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  setSyncConfig: (config: SyncConfig | null) => void;
  /** Build design results from selected secrets, grouped by detected service */
  buildResults: () => CredentialDesignResult[];
  goBack: () => void;
  reset: () => void;
}

export function useCredentialImport(): CredentialImportState & CredentialImportActions {
  const [phase, setPhase] = useState<ImportPhase>('pick_source');
  const [sourceId, setSourceId] = useState<ImportSourceId | null>(null);
  const [rawInput, setRawInput] = useState('');
  const [parseResult, setParseResult] = useState<ImportParseResult | null>(null);
  const [mappings, setMappings] = useState<SecretServiceMapping[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [syncConfig, setSyncConfig] = useState<SyncConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectSource = useCallback((id: ImportSourceId) => {
    setSourceId(id);
    setPhase('input');
    setRawInput('');
    setParseResult(null);
    setMappings([]);
    setSelectedKeys(new Set());
    setError(null);
  }, []);

  const parse = useCallback(() => {
    if (!sourceId || !rawInput.trim()) return;

    const result = parseImportInput(sourceId, rawInput.trim());
    setParseResult(result);

    if (result.secrets.length === 0) {
      setError(result.errors.length > 0 ? result.errors[0]! : 'No secrets found in the input');
      return;
    }

    const detectedMappings = buildMappings(result.secrets);
    setMappings(detectedMappings);
    setSelectedKeys(new Set(result.secrets.map((s) => s.key)));
    setError(null);
    setPhase('preview');
  }, [sourceId, rawInput]);

  const toggleKey = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (parseResult) {
      setSelectedKeys(new Set(parseResult.secrets.map((s) => s.key)));
    }
  }, [parseResult]);

  const deselectAll = useCallback(() => {
    setSelectedKeys(new Set());
  }, []);

  const buildResults = useCallback((): CredentialDesignResult[] => {
    if (!parseResult) return [];

    const selected = parseResult.secrets.filter((s) => selectedKeys.has(s.key));
    const selectedMappings = selected.map((s) => {
      const idx = parseResult.secrets.indexOf(s);
      return mappings[idx]!;
    });
    const groups = groupByService(selected, selectedMappings);
    const results: CredentialDesignResult[] = [];

    for (const [service, groupSecrets] of groups) {
      const mapping = selectedMappings.find((m) => m.detectedService === service);
      const connectorName = mapping?.connectorName ?? service.toLowerCase().replace(/\s+/g, '_');
      results.push(buildDesignResultFromImport(service, connectorName, groupSecrets));
    }

    return results;
  }, [parseResult, selectedKeys, mappings]);

  const goBack = useCallback(() => {
    switch (phase) {
      case 'input':
        setPhase('pick_source');
        setSourceId(null);
        break;
      case 'preview':
        setPhase('input');
        break;
      default:
        setPhase('pick_source');
        break;
    }
  }, [phase]);

  const reset = useCallback(() => {
    setPhase('pick_source');
    setSourceId(null);
    setRawInput('');
    setParseResult(null);
    setMappings([]);
    setSelectedKeys(new Set());
    setSyncConfig(null);
    setError(null);
  }, []);

  return {
    phase,
    sourceId,
    rawInput,
    parseResult,
    mappings,
    selectedKeys,
    syncConfig,
    error,
    selectSource,
    setRawInput,
    parse,
    toggleKey,
    selectAll,
    deselectAll,
    setSyncConfig,
    buildResults,
    goBack,
    reset,
  };
}
