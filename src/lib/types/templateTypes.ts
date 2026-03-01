import type { DesignAnalysisResult } from './designTypes';

export interface TemplateCatalogEntry {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  category: string[];
  featured?: boolean;
  payload: DesignAnalysisResult;
}

/** @deprecated Use TemplateCatalogEntry instead. */
export type BuiltinTemplate = TemplateCatalogEntry;

export interface N8nNode {
  type: string;
  name: string;
  parameters: Record<string, unknown>;
  position?: [number, number];
  typeVersion?: number;
}

export interface N8nWorkflow {
  name?: string;
  nodes: N8nNode[];
  connections: Record<string, {
    main?: Array<Array<{ node: string; type: string; index: number }>>;
  }>;
}
