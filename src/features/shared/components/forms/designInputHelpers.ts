import { FileText, Database, Settings, File } from 'lucide-react';
import type { DesignFileType } from '@/lib/types/frontendTypes';

export const FILE_TYPE_ICONS: Record<DesignFileType, typeof FileText> = {
  'api-spec': FileText,
  'schema': Database,
  'mcp-config': Settings,
  'other': File,
};

export const FILE_TYPE_LABELS: Record<DesignFileType, string> = {
  'api-spec': 'API Definition',
  'schema': 'Database Schema',
  'mcp-config': 'MCP Config',
  'other': 'Other',
};

export const ACCEPTED_EXTENSIONS = '.json,.yaml,.yml,.graphql,.sql,.prisma,.txt,.md';

export function detectFileType(fileName: string, content: string): DesignFileType {
  if (fileName.endsWith('.json') && content.includes('mcpServers')) return 'mcp-config';
  if (fileName.match(/\.(json|yaml|yml|graphql)$/)) return 'api-spec';
  if (fileName.match(/\.(sql|prisma)$/)) return 'schema';
  return 'other';
}
