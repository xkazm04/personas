import type { CustomTemplateCase } from '../runner/designRunnerConstants';

// -- Unified source type --------------------------------------------------

export interface TemplateSource {
  id: string;
  name: string;
  instruction: string;
  tools?: string;
  trigger?: string;
  category?: string;
}

// -- Discriminated union props --------------------------------------------

export interface PredefinedProps {
  mode: 'predefined';
}

export interface CustomProps {
  mode: 'custom';
  cases: CustomTemplateCase[];
  validCount: number;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdateCase: (index: number, field: keyof CustomTemplateCase, value: string) => void;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export interface BatchProps {
  mode: 'batch';
  templates: TemplateSource[];
  categoryFilter: string | null;
  onCategoryFilterChange: (filter: string | null) => void;
  onClear: () => void;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export type TemplateSourcePanelProps = PredefinedProps | CustomProps | BatchProps;
