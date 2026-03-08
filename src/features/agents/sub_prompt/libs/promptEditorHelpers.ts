import { User, BookOpen, Wrench, Code, AlertTriangle, Layers, Globe } from 'lucide-react';
import type { StructuredPrompt } from '@/lib/personas/promptMigration';
import type { SidebarEntry } from '../components/PromptSectionSidebar';

export const STANDARD_TABS: SidebarEntry[] = [
  { key: 'identity', label: 'Identity', Icon: User },
  { key: 'instructions', label: 'Instructions', Icon: BookOpen },
  { key: 'toolGuidance', label: 'Tool Guidance', Icon: Wrench },
  { key: 'examples', label: 'Examples', Icon: Code },
  { key: 'errorHandling', label: 'Error Handling', Icon: AlertTriangle },
  { key: 'webSearch', label: 'Web Search', Icon: Globe },
  { key: 'custom', label: 'Custom', Icon: Layers },
];

/** Compare two StructuredPrompt objects for equality (serialized). */
export function promptChanged(current: StructuredPrompt, baseline: StructuredPrompt): boolean {
  return JSON.stringify(current) !== JSON.stringify(baseline);
}
