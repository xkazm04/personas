import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Plus, LayoutGrid, Save, ChevronDown, Check, StickyNote } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useAgentStore } from "@/stores/agentStore";
import { usePipelineStore } from "@/stores/pipelineStore";
import { PersonaAvatar } from '../libs/teamConstants';
import { useTranslation } from '@/i18n/useTranslation';

interface TeamToolbarProps {
  teamName: string;
  onBack: () => void;
  onAutoLayout: () => void;
  onSave: () => void;
  onAddMember: (personaId: string) => void;
  onAddNote?: () => void;
  saveStatus?: 'saved' | 'saving' | 'unsaved';
}

export default function TeamToolbar({ teamName, onBack, onAutoLayout, onSave, onAddMember, onAddNote, saveStatus = 'saved' }: TeamToolbarProps) {
  const { t } = useTranslation();
  const personas = useAgentStore((s) => s.personas);
  const teamMembers = usePipelineStore((s) => s.teamMembers);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Filter out personas already in the team
  const memberPersonaIds = new Set(teamMembers.map((m: { persona_id: string }) => m.persona_id));
  const availablePersonas = personas.filter((p) => !memberPersonaIds.has(p.id));

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as globalThis.Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="flex items-center justify-between px-3 py-2 bg-secondary/70 backdrop-blur-lg border-b border-border/30">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-1.5 rounded-card hover:bg-primary/10 text-muted-foreground/80 hover:text-foreground/95 transition-all"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h2 className="text-sm font-semibold text-foreground/90">{teamName}</h2>
      </div>

      <div className="flex items-center gap-2">
        {/* Add Agent Dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-modal bg-indigo-500/10 border border-indigo-500/25 text-indigo-300 hover:bg-indigo-500/20 text-sm font-medium transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            {t.pipeline.add_agent}
            <ChevronDown className={`w-3 h-3 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
          </button>

          {showDropdown && (
            <div className="absolute right-0 top-full mt-1 w-56 rounded-modal bg-background/95 backdrop-blur-md border border-primary/20 shadow-elevation-3 z-50 overflow-hidden">
              <div className="p-1.5 max-h-60 overflow-y-auto">
                {availablePersonas.length === 0 ? (
                  <div className="px-3 py-4 text-center text-sm text-muted-foreground/90">
                    {t.pipeline.all_agents_added}
                  </div>
                ) : (
                  availablePersonas.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        onAddMember(p.id);
                        setShowDropdown(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-modal hover:bg-secondary/60 transition-colors"
                    >
                      <PersonaAvatar icon={p.icon} color={p.color} size="sm" />
                      <span className="text-sm font-medium text-foreground/80 truncate">{p.name}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Add Sticky Note */}
        {onAddNote && (
          <button
            onClick={onAddNote}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-modal bg-amber-500/10 border border-amber-500/25 text-amber-300 hover:bg-amber-500/20 text-sm font-medium transition-all"
          >
            <StickyNote className="w-3.5 h-3.5" />
            {t.pipeline.note}
          </button>
        )}

        {/* Auto Layout */}
        <button
          onClick={onAutoLayout}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-modal bg-secondary/60 border border-primary/15 text-muted-foreground/90 hover:text-foreground/95 hover:bg-secondary/80 text-sm font-medium transition-all"
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          {t.pipeline.layout}
        </button>

        {/* Save */}
        <button
          onClick={onSave}
          disabled={saveStatus === 'saving'}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-modal border text-sm font-medium transition-all ${
            saveStatus === 'saved'
              ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300/60'
              : saveStatus === 'saving'
                ? 'bg-amber-500/10 border-amber-500/25 text-amber-300 cursor-wait'
                : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/20'
          }`}
        >
          {saveStatus === 'saving' ? (
            <LoadingSpinner size="sm" />
          ) : saveStatus === 'saved' ? (
            <Check className="w-3.5 h-3.5" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          {saveStatus === 'saving' ? t.pipeline.saving : saveStatus === 'saved' ? t.pipeline.saved : t.common.save}
        </button>
      </div>
    </div>
  );
}
