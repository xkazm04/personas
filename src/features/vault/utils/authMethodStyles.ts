import type { ConnectorAuthMethod } from '@/lib/types/types';

/** Returns Tailwind classes for auth method badge styling. */
export function getAuthBadgeClasses(method: ConnectorAuthMethod): string {
  if (method.type === 'mcp')
    return 'bg-cyan-500/15 border-cyan-500/25 text-cyan-400/80';
  if (method.type === 'oauth' || method.label.toLowerCase() === 'oauth')
    return 'bg-blue-500/15 border-blue-500/25 text-blue-400/80';

  const id = method.id.toLowerCase();
  if (id.includes('bot') || method.label.toLowerCase().includes('bot'))
    return 'bg-purple-500/15 border-purple-500/25 text-purple-400/80';

  return 'bg-background/80 border-primary/10 text-muted-foreground/60';
}
