import { Server, Terminal } from 'lucide-react';
import type { ConnectorAuthMethod } from '@/lib/types/types';
import Button from '@/features/shared/components/buttons/Button';

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
        <Button
          type="button"
          key={method.id}
          onClick={() => onMethodChange(method)}
          pressed={activeAuthMethodId === method.id}
          variant={activeAuthMethodId === method.id ? 'accent' : 'ghost'}
          tone={activeAuthMethodId === method.id ? 'highlight' : undefined}
          size="sm"
          icon={method.type === 'mcp' ? <Server className="w-3 h-3" /> : method.type === 'cli' ? <Terminal className="w-3 h-3" /> : null}
        >
          {method.label}
        </Button>
      ))}
    </div>
  );
}
