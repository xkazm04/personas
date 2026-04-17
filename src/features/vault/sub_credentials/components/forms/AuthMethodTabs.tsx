import { Server, Terminal } from 'lucide-react';
import type { ConnectorAuthMethod } from '@/lib/types/types';
import { getAuthBadgeClasses } from '@/features/vault/shared/utils/authMethodStyles';

interface AuthMethodTabsProps {
  authMethods: ConnectorAuthMethod[];
  activeAuthMethodId: string;
  onMethodChange: (method: ConnectorAuthMethod) => void;
}

export function AuthMethodTabs({
  authMethods,
  activeAuthMethodId,
  onMethodChange,
}: AuthMethodTabsProps) {
  if (authMethods.length <= 1) return null;

  return (
    <div className="flex gap-1 p-1 bg-secondary/15 border border-primary/8 rounded-card">
      {authMethods.map((method) => (
        <button
          key={method.id}
          onClick={() => onMethodChange(method)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-modal text-sm font-medium transition-colors ${
            activeAuthMethodId === method.id
              ? `border ${getAuthBadgeClasses(method)}`
              : 'text-muted-foreground/80 hover:bg-secondary/40 border border-transparent'
          }`}
        >
          {method.type === 'mcp' && <Server className="w-3 h-3" />}
          {method.type === 'cli' && <Terminal className="w-3 h-3" />}
          {method.label}
        </button>
      ))}
    </div>
  );
}
