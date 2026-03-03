import { Key, User, Bot, Shield, Server, Lock, Database, Link2, KeyRound } from 'lucide-react';
import type { ConnectorAuthMethod } from '@/lib/types/types';

/** Returns Tailwind classes for auth method badge styling. */
export function getAuthBadgeClasses(method: ConnectorAuthMethod): string {
  if (method.type === 'mcp')
    return 'bg-cyan-500/20 border-cyan-500/30 text-cyan-300';
  if (method.type === 'oauth' || method.label.toLowerCase() === 'oauth')
    return 'bg-blue-500/20 border-blue-500/30 text-blue-300';

  const id = method.id.toLowerCase();
  if (id.includes('bot') || method.label.toLowerCase().includes('bot'))
    return 'bg-purple-500/20 border-purple-500/30 text-purple-300';

  // Default: white/bright instead of gray
  return 'bg-white/10 border-white/20 text-white/90';
}

/** Map auth type id → lucide icon component. */
export function getAuthIcon(method: ConnectorAuthMethod): typeof Key {
  if (method.type === 'mcp') return Server;
  if (method.type === 'oauth' || method.label.toLowerCase() === 'oauth') return Shield;

  const id = method.id.toLowerCase();
  const label = method.label.toLowerCase();

  if (id.includes('bot') || label.includes('bot')) return Bot;
  if (id === 'pat' || label === 'pat') return User;
  if (id.includes('api_key') || label.includes('api key')) return Key;
  if (id.includes('api_token') || label.includes('api token')) return KeyRound;
  if (id.includes('deploy_key') || label.includes('deploy')) return KeyRound;
  if (id.includes('service_token') || label.includes('service')) return Lock;
  if (id.includes('write_key') || label.includes('write key')) return KeyRound;
  if (id.includes('basic') || label.includes('account')) return Lock;
  if (id.includes('connection') || label.includes('connection')) return Database;
  if (id.includes('rest') || label.includes('rest')) return Link2;

  return Key;
}
