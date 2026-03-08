export interface ToolDef {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  requires_credential_type?: string | null;
}

export { ToolCheckbox } from './ToolCheckbox';
export { ToolCard } from './ToolCard';
export { GroupedToolRow } from './GroupedToolRow';
