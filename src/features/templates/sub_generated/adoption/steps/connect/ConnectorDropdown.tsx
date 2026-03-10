/**
 * ConnectorDropdown — dropdown for selecting alternative connectors within a role.
 */
import { useState, useMemo, useEffect, useRef } from 'react';
import { CheckCircle2, ChevronDown, Star } from 'lucide-react';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import type { CredentialMetadata } from '@/lib/types/types';

const BUILTIN_CONNECTORS = new Set(['personas_messages', 'personas_database']);

export function ConnectorDropdown({
  members,
  activeName,
  recommendedName,
  onSelect,
  credentials,
}: {
  members: string[];
  activeName: string;
  recommendedName: string;
  onSelect: (name: string) => void;
  credentials: CredentialMetadata[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const activeMeta = getConnectorMeta(activeName);

  // Filter to only connectors user has credentials for (+ always keep active + built-in), sorted by name
  const adoptedMembers = useMemo(() => {
    const credServiceTypes = new Set(credentials.map((c) => c.service_type));
    const filtered = members.filter(
      (m) => m === activeName || credServiceTypes.has(m) || BUILTIN_CONNECTORS.has(m),
    );
    return filtered.sort((a, b) => {
      const labelA = getConnectorMeta(a).label.toLowerCase();
      const labelB = getConnectorMeta(b).label.toLowerCase();
      return labelA.localeCompare(labelB);
    });
  }, [members, activeName, credentials]);
  const isRecommended = activeName === recommendedName;

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 bg-background/50 border border-primary/10 rounded-lg text-sm text-foreground/80 hover:border-primary/20 transition-colors text-left"
      >
        <ConnectorIcon meta={activeMeta} size="w-3.5 h-3.5" />
        <span className="flex-1 truncate">{activeMeta.label}</span>
        {isRecommended && (
          <span className="inline-flex items-center gap-0.5 px-1 py-0.5 text-[10px] font-medium rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/20" title="Original template connector">
            <Star className="w-2 h-2" />
          </span>
        )}
        <ChevronDown className={`w-3 h-3 text-muted-foreground/50 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 z-20 bg-background border border-primary/20 rounded-xl shadow-xl overflow-hidden">
          <div className="max-h-[240px] overflow-y-auto py-1">
            {adoptedMembers.map((member) => {
              const memberMeta = getConnectorMeta(member);
              const isActive = member === activeName;
              const isRec = member === recommendedName;
              return (
                <button
                  key={member}
                  type="button"
                  onClick={() => {
                    onSelect(member);
                    setIsOpen(false);
                  }}
                  className={`flex items-center gap-2.5 w-full px-3 py-2 text-left transition-colors ${
                    isActive
                      ? 'bg-violet-500/10 text-violet-300'
                      : 'text-foreground/80 hover:bg-primary/5'
                  }`}
                >
                  <ConnectorIcon meta={memberMeta} size="w-3.5 h-3.5" />
                  <span className="text-sm flex-1 truncate">{memberMeta.label}</span>
                  {isRec && (
                    <span className="text-[10px] text-violet-400/60">Original</span>
                  )}
                  {isActive && <CheckCircle2 className="w-3 h-3 text-violet-400 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
